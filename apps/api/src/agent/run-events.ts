import { Injectable } from '@nestjs/common';
import type { ProposedClass, RemarkStatus } from '@remarkround/db';
import type { CitationView } from '../remarks/remark.dto';

/** docs/WS.md — фазы одной строкой внизу карточки. */
export type Phase = 'retrieving' | 'vision' | 'binding' | 'drafting' | 'awaiting_pm' | 'diffing' | 'awaiting_business_close' | 'persisted' | 'failed';

/** docs/WS.md сервер → клиент. `run.cancelled` добавлен в фазе 6: run.cancel не вердикт и не сбой. */
export type ServerEvent =
  | { type: 'run.phase'; runId: string; phase: Phase }
  | { type: 'run.token'; runId: string; delta: string }
  | { type: 'run.citations'; runId: string; citations: CitationView[] }
  | { type: 'run.proposal'; runId: string; proposedClass: ProposedClass; rationale: string }
  | { type: 'run.persisted'; runId: string; remarkStatus: RemarkStatus }
  | { type: 'run.cancelled'; runId: string; remarkStatus: RemarkStatus }
  | { type: 'run.failed'; runId: string; message: string }
  | { type: 'presence'; userId: string; role: string; name: string; action: 'join' | 'leave' };

export type RunListener = (remarkId: string, event: ServerEvent) => void;

/**
 * Шина событий прогона: ноды графа и AgentService пишут сюда, WS-гейтвей раздаёт в комнату `remark:{id}`.
 * Без Nest EventEmitter: одна очередь, синхронно, без магических строк.
 */
@Injectable()
export class RunEvents {
  private readonly listeners = new Set<RunListener>();
  /** Последняя фаза по runId — для ack на join, когда клиент подключился посреди прогона. */
  private readonly phases = new Map<string, Phase>();

  emit(remarkId: string, event: ServerEvent): void {
    if (event.type === 'run.phase') this.phases.set(event.runId, event.phase);
    if (event.type === 'run.persisted' || event.type === 'run.failed' || event.type === 'run.cancelled') this.phases.delete(event.runId);
    for (const fn of this.listeners) {
      try {
        fn(remarkId, event);
      } catch {
        /* слушатель не должен ронять прогон */
      }
    }
  }

  on(fn: RunListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  phaseOf(runId: string): Phase | undefined {
    return this.phases.get(runId);
  }
}
