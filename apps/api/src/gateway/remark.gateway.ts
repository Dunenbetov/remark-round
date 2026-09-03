import { HttpException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { AgentService } from '../agent/agent.service';
import { RunEvents, type Phase, type ServerEvent } from '../agent/run-events';
import { AuthService, type AuthUser } from '../auth/auth.service';
import { CancelRunDto, RemarkView, VerdictDto } from '../remarks/remark.dto';
import { RemarksService } from '../remarks/remarks.service';
import type { ProjectContext } from '../tenancy/project-context';
import { TenancyService } from '../tenancy/tenancy.service';

/** Путь под тем же /api, что и REST: nginx и dev-прокси проксируют одно место. */
export const WS_PATH = '/api/v1/ws';

interface JoinBody {
  projectId?: unknown;
  remarkId?: unknown;
}

export interface Presence {
  userId: string;
  role: string;
  name: string;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; message: string };
export type JoinAck = Ack<{ runId?: string; phase?: Phase; presence: Presence[] }>;
export type CommandAck = Ack<{ remark: RemarkView }>;

interface SocketData {
  user: AuthUser;
  /** remarkId → контекст проекта, проверенный на join (docs/WS.md: membership проверяется на join). */
  rooms: Map<string, ProjectContext>;
}

/**
 * Комната замечания `remark:{id}` (docs/WS.md). Auth — тот же JWT при connect, membership — на join.
 * verdict.* и run.cancel идут в те же методы AgentService, что REST: один путь записи, та же идемпотентность.
 */
@WebSocketGateway({ path: WS_PATH, cors: { origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:4200', credentials: true } })
export class RemarkGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(RemarkGateway.name);
  private readonly presence = new Map<string, Map<string, Presence>>();
  private off: (() => void) | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly tenancy: TenancyService,
    private readonly remarks: RemarksService,
    private readonly agent: AgentService,
    private readonly events: RunEvents,
  ) {}

  onModuleInit(): void {
    this.off = this.events.on((remarkId, event) => this.server?.to(room(remarkId)).emit(event.type, event));
  }

  onModuleDestroy(): void {
    this.off?.();
  }

  /**
   * Auth — middleware socket.io: соединение устанавливается только после проверки JWT, поэтому клиент
   * не успевает послать join раньше, чем сервер узнал пользователя. Плохой токен — connect_error «Нет доступа».
   */
  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const auth = socket.handshake.auth as { token?: unknown } | undefined;
      const header = socket.handshake.headers.authorization ?? '';
      const token = typeof auth?.token === 'string' ? auth.token : header.startsWith('Bearer ') ? header.slice(7) : '';
      try {
        const user = await this.auth.userFromToken(token);
        (socket.data as SocketData).user = user;
        (socket.data as SocketData).rooms = new Map();
        next();
      } catch {
        next(new Error('Нет доступа'));
      }
    });
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as Partial<SocketData>;
    for (const remarkId of data.rooms?.keys() ?? []) this.leaveRoom(socket, remarkId);
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: JoinBody): Promise<JoinAck> {
    const data = socket.data as Partial<SocketData>;
    if (!data.user || !data.rooms) return { ok: false, status: 401, message: 'Нет доступа' };
    const projectId = typeof body?.projectId === 'string' ? body.projectId : '';
    const remarkId = typeof body?.remarkId === 'string' ? body.remarkId : '';
    if (!projectId || !remarkId) return { ok: false, status: 422, message: 'Нужны projectId и remarkId' };
    const ctx = await this.tenancy.contextFor(data.user.id, projectId);
    if (!ctx) return { ok: false, status: 404, message: 'Нет доступа' };
    let remark: RemarkView;
    try {
      remark = await this.remarks.get(ctx, remarkId);
    } catch (e) {
      return failure(e);
    }
    data.rooms.set(remarkId, ctx);
    await socket.join(room(remarkId));
    const me: Presence = { userId: data.user.id, role: ctx.role, name: data.user.name };
    const members = this.presence.get(remarkId) ?? new Map<string, Presence>();
    const others = [...members.entries()].filter(([id]) => id !== socket.id).map(([, p]) => p);
    members.set(socket.id, me);
    this.presence.set(remarkId, members);
    socket.to(room(remarkId)).emit('presence', { type: 'presence', ...me, action: 'join' } satisfies ServerEvent);
    const runId = remark.runStatus === 'running' || remark.runStatus === 'awaiting_human' ? remark.runId : undefined;
    return { ok: true, runId, phase: runId ? this.agent.phaseOf(runId) : undefined, presence: dedupe(others) };
  }

  @SubscribeMessage('leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() body: JoinBody): Ack {
    const remarkId = typeof body?.remarkId === 'string' ? body.remarkId : '';
    if (remarkId) this.leaveRoom(socket, remarkId);
    return { ok: true };
  }

  @SubscribeMessage('verdict.approve')
  approve(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<CommandAck> {
    return this.command(socket, body, VerdictDto, (ctx, remarkId, dto) => {
      if (dto.verdict === 'rejected_binding') throw new HttpException('Для «Не та цитата из ТЗ» есть verdict.reject_binding', 422);
      return this.agent.verdict(ctx, remarkId, dto);
    });
  }

  @SubscribeMessage('verdict.reject_binding')
  rejectBinding(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<CommandAck> {
    return this.command(socket, body, VerdictDto, (ctx, remarkId, dto) => this.agent.verdict(ctx, remarkId, { ...dto, verdict: 'rejected_binding' }));
  }

  @SubscribeMessage('run.cancel')
  cancel(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<CommandAck> {
    return this.command(socket, body, CancelRunDto, (ctx, remarkId, dto) => this.agent.cancel(ctx, remarkId, dto.runId));
  }

  /** Общий путь команды: комната должна быть уже занята (join = membership), тело — по тем же DTO, что REST. */
  private async command<T extends object>(
    socket: Socket,
    body: unknown,
    Dto: new () => T,
    fn: (ctx: ProjectContext, remarkId: string, dto: T) => Promise<RemarkView>,
  ): Promise<CommandAck> {
    const data = socket.data as SocketData;
    const raw = (body ?? {}) as { remarkId?: unknown; verdict?: unknown };
    const remarkId = typeof raw.remarkId === 'string' ? raw.remarkId : '';
    const ctx = data.rooms?.get(remarkId);
    if (!ctx) return { ok: false, status: 404, message: 'Сначала откройте карточку (join)' };
    const dto = plainToInstance(Dto, raw, { excludeExtraneousValues: false });
    const errors = await validate(dto, { whitelist: true });
    if (errors.length) return { ok: false, status: 422, message: errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ') };
    // reject_binding приходит отдельным событием, но тело — VerdictDto: verdict проставляем в обработчике.
    if (Dto === (VerdictDto as unknown) && raw.verdict === undefined) (dto as unknown as VerdictDto).verdict = 'rejected_binding';
    try {
      return { ok: true, remark: await fn(ctx, remarkId, dto) };
    } catch (e) {
      return failure(e);
    }
  }

  private leaveRoom(socket: Socket, remarkId: string): void {
    const data = socket.data as Partial<SocketData>;
    const members = this.presence.get(remarkId);
    const me = members?.get(socket.id);
    members?.delete(socket.id);
    if (members && members.size === 0) this.presence.delete(remarkId);
    data.rooms?.delete(remarkId);
    void socket.leave(room(remarkId));
    if (me) socket.to(room(remarkId)).emit('presence', { type: 'presence', ...me, action: 'leave' } satisfies ServerEvent);
  }
}

function room(remarkId: string): string {
  return `remark:${remarkId}`;
}

function dedupe(list: Presence[]): Presence[] {
  const seen = new Map<string, Presence>();
  for (const p of list) seen.set(p.userId, p);
  return [...seen.values()];
}

function failure(e: unknown): { ok: false; status: number; message: string } {
  if (e instanceof HttpException) {
    const res = e.getResponse();
    const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? e.message);
    return { ok: false, status: e.getStatus(), message: Array.isArray(message) ? message.join(', ') : String(message) };
  }
  return { ok: false, status: 500, message: 'Ошибка запроса' };
}
