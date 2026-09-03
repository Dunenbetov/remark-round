import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { Prisma } from '@remarkround/db';
import { PrismaService } from '../prisma/prisma.service';

/** Сериализованное значение: тип из JsonPlusSerializer + base64 байтов. */
type Stored = [type: string, base64: string];
/** writes в колонке: ключ «taskId,idx» → [taskId, channel, значение] */
type StoredWrites = Record<string, [taskId: string, channel: string, value: Stored]>;

/**
 * Чекпоинтер LangGraph поверх таблицы GraphCheckpoint (thread_id = AgentRun.id).
 * Порт MemorySaver: тот же формат сериализации, только строки в Postgres. Поэтому interrupt
 * «на дни» переживает рестарт API, а «Не та цитата» продолжает тот же run из его последнего чекпоинта.
 */
export class PrismaCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const runId = config.configurable?.['thread_id'] as string | undefined;
    if (!runId) return undefined;
    const ns = (config.configurable?.['checkpoint_ns'] as string | undefined) ?? '';
    const checkpointId = getCheckpointId(config);
    const row = checkpointId
      ? await this.prisma.graphCheckpoint.findUnique({ where: { runId_ns_checkpointId: { runId, ns, checkpointId } } })
      : await this.prisma.graphCheckpoint.findFirst({ where: { runId, ns }, orderBy: { checkpointId: 'desc' } });
    if (!row) return undefined;
    return this.toTuple(row);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const runId = config.configurable?.['thread_id'] as string | undefined;
    const ns = config.configurable?.['checkpoint_ns'] as string | undefined;
    const before = options?.before?.configurable?.['checkpoint_id'] as string | undefined;
    const rows = await this.prisma.graphCheckpoint.findMany({
      where: { ...(runId ? { runId } : {}), ...(ns !== undefined ? { ns } : {}), ...(before ? { checkpointId: { lt: before } } : {}) },
      orderBy: [{ runId: 'asc' }, { checkpointId: 'desc' }],
      ...(options?.limit !== undefined ? { take: options.limit } : {}),
    });
    for (const row of rows) {
      const tuple = await this.toTuple(row);
      if (options?.filter && !Object.entries(options.filter).every(([k, v]) => (tuple.metadata as Record<string, unknown> | undefined)?.[k] === v)) continue;
      yield tuple;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig> {
    const runId = config.configurable?.['thread_id'] as string | undefined;
    if (!runId) throw new Error('PrismaCheckpointSaver.put: нет thread_id (runId)');
    const ns = (config.configurable?.['checkpoint_ns'] as string | undefined) ?? '';
    const parentId = (config.configurable?.['checkpoint_id'] as string | undefined) ?? null;
    const [blob, meta] = await Promise.all([this.dump(copyCheckpoint(checkpoint)), this.dump(metadata)]);
    await this.prisma.graphCheckpoint.upsert({
      where: { runId_ns_checkpointId: { runId, ns, checkpointId: checkpoint.id } },
      create: { runId, ns, checkpointId: checkpoint.id, parentId, blob: blob as unknown as Prisma.InputJsonValue, metadata: meta as unknown as Prisma.InputJsonValue },
      update: { parentId, blob: blob as unknown as Prisma.InputJsonValue, metadata: meta as unknown as Prisma.InputJsonValue },
    });
    return { configurable: { thread_id: runId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const runId = config.configurable?.['thread_id'] as string | undefined;
    const ns = (config.configurable?.['checkpoint_ns'] as string | undefined) ?? '';
    const checkpointId = config.configurable?.['checkpoint_id'] as string | undefined;
    if (!runId || !checkpointId) throw new Error('PrismaCheckpointSaver.putWrites: нет thread_id или checkpoint_id');
    const patch: StoredWrites = {};
    for (const [idx, [channel, value]] of writes.entries()) {
      const key = `${taskId},${WRITES_IDX_MAP[channel] ?? idx}`;
      patch[key] = [taskId, channel, await this.dump(value)];
    }
    // Атомарное слияние jsonb: параллельные задачи одного шага не затирают друг друга.
    await this.prisma.$executeRaw`
      UPDATE "GraphCheckpoint" SET "writes" = "writes" || ${JSON.stringify(patch)}::jsonb
      WHERE "runId" = ${runId} AND "ns" = ${ns} AND "checkpointId" = ${checkpointId}
    `;
  }

  async deleteThread(runId: string): Promise<void> {
    await this.prisma.graphCheckpoint.deleteMany({ where: { runId } });
  }

  private async toTuple(row: { runId: string; ns: string; checkpointId: string; parentId: string | null; blob: unknown; metadata: unknown; writes: unknown }): Promise<CheckpointTuple> {
    const checkpoint = (await this.load(row.blob as Stored)) as Checkpoint;
    const metadata = (await this.load(row.metadata as Stored)) as CheckpointMetadata;
    const pendingWrites: CheckpointPendingWrite[] = [];
    for (const [taskId, channel, value] of Object.values((row.writes as StoredWrites | null) ?? {})) {
      pendingWrites.push([taskId, channel, await this.load(value)]);
    }
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: row.runId, checkpoint_ns: row.ns, checkpoint_id: row.checkpointId } },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (row.parentId) tuple.parentConfig = { configurable: { thread_id: row.runId, checkpoint_ns: row.ns, checkpoint_id: row.parentId } };
    return tuple;
  }

  private async dump(value: unknown): Promise<Stored> {
    const [type, bytes] = await this.serde.dumpsTyped(value);
    return [type, Buffer.from(bytes).toString('base64')];
  }

  private load(stored: Stored | null): Promise<unknown> {
    if (!stored) return Promise.resolve(undefined);
    const [type, base64] = stored;
    return this.serde.loadsTyped(type, new Uint8Array(Buffer.from(base64, 'base64')));
  }
}
