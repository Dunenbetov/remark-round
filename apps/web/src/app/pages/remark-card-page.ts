import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { JoinAck, Phase, Presence, Remark, Screenshot, ServerEvent, VerdictCode } from '../core/models';
import { APP_NAME, CARD, DECISION, EMPTY, NEW_REMARK, PHASE_EXTRA, PHASE_TEXT, PRESENCE, ROLE_GENITIVE, ROUND, STATUS_LABEL, TITLE, VERDICT_LABEL } from '../core/copy';
import { PendingActionService } from '../core/pending-action.service';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { TriageRun, TriageService } from '../core/triage.service';
import { WsService, initialPhase } from '../core/ws.service';
import { AppBar } from '../ui/app-bar';
import { Citation } from '../ui/citation';
import { DecisionMode, DecisionPanel, DecisionPending, DecisionRecord } from '../ui/decision-panel';
import { PhaseLine, PhaseTone } from '../ui/phase-line';
import { Shot } from '../ui/shot';
import { ShotViewer, ViewerFrame } from '../ui/shot-viewer';
import { StatusPill } from '../ui/status-pill';

/** fix — строка журнала без описания: человек дописывает её прямо на карточке. */
type Layout = 'running' | 'draft' | 'refuse' | 'retest-wait' | 'retest' | 'fix';
type FileAction = 'attach' | 'retest';

/** Без сокета (сеть, прокси) карточка перечитывает замечание, пока прогон идёт. С сокетом — только события. */
const FALLBACK_POLL_MS = 3000;

/**
 * Карточка замечания — главный экран. Три колонки на бумаге: Улики | Черновик разбора | Ваше решение.
 * Режим выбирается по статусу × роли. Данные и переходы — API; решения уходят через PendingActionService.
 */
@Component({
  selector: 'rr-remark-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AppBar, Shot, StatusPill, Citation, DecisionPanel, PhaseLine, ShotViewer],
  template: `
    @if (remark(); as r) {
      @if (allowed()) {
        <div class="page">
          <rr-app-bar [tabs]="false" />
          <main id="main" class="page__body card-body">
            <a class="link card__back" [routerLink]="backLink()">{{ role() === 'developer' ? copy.backDev : copy.back }}</a>
            <article class="paper card" [attr.data-status]="r.status">
              <header class="card__head">
                <span class="num card__n">№ {{ r.number }}</span>
                <h1 class="card__title">{{ r.title }}</h1>
                @if (showPill()) {
                  <rr-status-pill class="card__pill" [status]="r.status" [dot]="true" />
                }
                <span class="meta card__meta">{{ metaLine() }}</span>
                @if (watching(); as w) {
                  <span class="meta card__presence" aria-live="polite">{{ w }}</span>
                }
              </header>

              <div class="grid" [class.grid--retest]="layout() === 'retest'">
                <!-- УЛИКИ -->
                <section class="col col--evidence">
                  <h2 class="col-title">{{ copy.evidence }}</h2>
                  @if (layout() === 'retest' && frames().length > 1) {
                    <div class="frames" [class.frames--two]="frames().length === 2">
                      @for (f of frames(); track f.label; let i = $index) {
                        <button type="button" class="frame" [attr.aria-label]="f.label + ' · ' + copy.zoomOpen" (click)="openViewer(i)">
                          <rr-shot [variant]="f.variant" [src]="f.src" [zoom]="true" />
                          <span class="meta">{{ f.label }}</span>
                        </button>
                      }
                    </div>
                  } @else if (original(); as s) {
                    <button type="button" class="frame" [attr.aria-label]="copy.frame + ' · ' + copy.zoomOpen" (click)="openViewer(0)">
                      <rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" [zoom]="true" />
                      @if (layout() === 'retest-wait' || layout() === 'retest') {
                        <span class="meta">{{ copy.before }}</span>
                      }
                    </button>
                    @if (layout() === 'retest-wait' && role() === 'business') {
                      <div class="attach">
                        <button type="button" class="btn btn--secondary" [class.btn--busy]="busy()" [disabled]="busy()" (click)="pickFile('retest')">{{ decision.attachShot }}</button>
                        <span class="meta">{{ decision.attachNewFrame }}</span>
                      </div>
                    }
                  } @else {
                    <div class="no-shot">{{ copy.noShot }}</div>
                  }
                  @if (layout() === 'fix') {
                    <dl class="cells">
                      @if (r.pageOrScreen !== '—') {
                        <dt>{{ copy.where }}</dt>
                        <dd>{{ r.pageOrScreen }}</dd>
                      }
                      @if (r.expected) {
                        <dt>{{ newRemark.expected }}</dt>
                        <dd>{{ r.expected }}</dd>
                      }
                      @if (r.severity) {
                        <dt>{{ copy.severity }}</dt>
                        <dd>{{ r.severity }}</dd>
                      }
                    </dl>
                  }

                  @if (layout() === 'retest') {
                    <h2 class="col-title col-title--gap">{{ copy.draft }}</h2>
                    <div class="retest-draft">
                      <div class="retest-draft__verdict">{{ retestVerdict() }}</div>
                      <div class="retest-draft__text">{{ r.retest?.explanation }}</div>
                      @if (specCitation(); as c) {
                        <rr-citation class="retest-draft__cite" [citation]="c" [documentsLink]="documentsLink()" />
                      }
                    </div>
                  }
                </section>

                <!-- ЧЕРНОВИК РАЗБОРА -->
                @if (layout() !== 'retest') {
                  <section class="col col--draft">
                    <h2 class="col-title">{{ copy.draft }}</h2>
                    @switch (layout()) {
                      @case ('fix') {
                        <div class="refuse">{{ empty.importUnparsed }}</div>
                        <div class="soft">{{ copy.fixRowHint }}</div>
                      }
                      @case ('refuse') {
                        <div class="refuse">{{ copy.refuse }}</div>
                        <div class="soft">{{ copy.refuseWhy }}</div>
                      }
                      @case ('retest-wait') {
                        @if (specCitation(); as c) {
                          <rr-citation [citation]="c" [documentsLink]="documentsLink()" />
                        }
                        <div class="soft">{{ copy.compareHint }}</div>
                      }
                      @default {
                        @if (specCitation(); as c) {
                          <rr-citation [citation]="c" [documentsLink]="documentsLink()" [visible]="quoteVisible()" />
                        }
                        @for (c of otherCitations(); track c.id) {
                          <rr-citation [citation]="c" />
                        }
                        @if (r.seen) {
                          <div class="soft"><span class="seen">{{ copy.seen }}</span> {{ r.seen }}</div>
                        }
                        @if (!running()) {
                          <div class="draft fade" [style.opacity]="draftVisible() ? 1 : 0" aria-live="polite">
                            @for (p of r.draft; track $index) {
                              <p class="draft__p">{{ p }}</p>
                            }
                          </div>
                        } @else if (streamed().length) {
                          <div class="draft draft--stream" aria-live="polite">
                            @for (p of streamed(); track $index) {
                              <p class="draft__p">{{ p }}</p>
                            }
                          </div>
                        }
                      }
                    }
                  </section>
                }

                <!-- ВАШЕ РЕШЕНИЕ -->
                <section class="col col--decision">
                  @if (decisionMode(); as mode) {
                    <h2 class="col-title col-title--decision">{{ decision.title }}</h2>
                    <rr-decision-panel
                      [mode]="mode"
                      [busy]="busy() || store.loading()"
                      [record]="record()"
                      [pending]="pendingFor()"
                      [attachHint]="decision.attachFooterHint"
                      (verdict)="onVerdict($event)"
                      (rejectBinding)="onRejectBinding($event)"
                      (attach)="pickFile('attach')"
                      (close)="onClose()"
                      (notFixed)="onNotFixed()"
                      (undo)="undo()"
                    />
                  } @else if (r.status === 'awaiting_pm' || r.status === 'triaging') {
                    <h2 class="col-title">{{ decision.title }}</h2>
                    <div class="soft">{{ copy.awaitingPmNote }}</div>
                  } @else if (layout() === 'fix' && canFix()) {
                    <h2 class="col-title col-title--decision">{{ statusLabel.needs_human_parse }}</h2>
                    <form class="fix" (submit)="onFix($event)" novalidate>
                      <label class="field">
                        <span class="field__label">{{ newRemark.what }}</span>
                        <textarea class="textarea" rows="4" name="what" [placeholder]="newRemark.whatPlaceholder" [value]="fixWhat()" [disabled]="store.loading()" (input)="fixWhat.set(value($event))"></textarea>
                      </label>
                      <label class="field">
                        <span class="field__label">{{ newRemark.where }}</span>
                        <input class="input" name="where" [placeholder]="newRemark.wherePlaceholder" [value]="fixWhere()" [disabled]="store.loading()" (input)="fixWhere.set(value($event))" />
                      </label>
                      <button type="submit" class="btn btn--primary btn--left" [class.btn--busy]="store.loading()" [disabled]="store.loading() || !fixWhat().trim()">{{ newRemark.save }}</button>
                    </form>
                  }
                  @if (role() === 'developer' && r.status === 'defect') {
                    @if (pendingFor(); as p) {
                      <rr-decision-panel mode="record" [pending]="p" (undo)="undo()" />
                    } @else {
                      <button type="button" class="btn btn--primary btn--left dev-ready" [disabled]="store.loading()" (click)="onReady()">{{ decision.readyForRetest }}</button>
                    }
                  }
                  @if (store.error(); as err) {
                    <div class="card__error" role="alert">{{ err }}</div>
                  }
                </section>
              </div>

              <footer class="card__foot">
                <rr-phase-line [text]="phaseText()" [tone]="phaseTone()" [pulse]="phasePulse()" [retryable]="failed()" [stoppable]="stoppable()" (retry)="onRetry()" (stop)="onStop()" />
                @if (r.traceUrl && role() === 'pm') {
                  <a class="link card__trace" [href]="r.traceUrl" target="_blank" rel="noopener">{{ traceLabel }}</a>
                }
              </footer>
            </article>
          </main>
          <input #file type="file" class="visually-hidden" accept="image/*" (change)="onFile($event)" />
          @if (viewer() !== null) {
            <rr-shot-viewer [title]="'№ ' + r.number + ' · ' + r.title" [frames]="frames()" [initial]="viewer()!" (closed)="viewer.set(null)" />
          }
        </div>
      } @else {
        <div class="page">
          <rr-app-bar [brandOnly]="true" />
          <main id="main" class="page__body denied">{{ empty.noAccess }}</main>
        </div>
      }
    } @else if (!store.loading()) {
      <div class="page">
        <rr-app-bar [brandOnly]="true" />
        <main id="main" class="page__body denied">{{ empty.noAccess }}</main>
      </div>
    }
  `,
  styles: `
    .card-body {
      margin-bottom: var(--sp-8);
    }
    .card__back {
      display: inline-block;
      margin-bottom: var(--sp-3);
      align-self: flex-start;
      font-size: var(--fs-14);
    }
    .card {
      padding: var(--sp-6) var(--sp-7) var(--sp-4);
    }
    .card__head {
      display: flex;
      align-items: baseline;
      gap: var(--sp-3);
      margin-bottom: var(--sp-5);
      flex-wrap: wrap;
    }
    .card__n {
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      color: var(--rr-ink-2);
    }
    .card__title {
      margin: 0;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      letter-spacing: -0.01em;
    }
    .card__pill {
      align-self: center;
    }
    .card__meta {
      margin-left: auto;
    }
    .card__presence {
      flex-basis: 100%;
      color: var(--rr-ink-3);
    }
    .draft--stream {
      color: var(--rr-ink-2);
    }
    .grid {
      display: grid;
      grid-template-columns: 1.15fr 1fr 0.85fr;
      gap: var(--sp-7);
      align-items: start;
    }
    .grid--retest {
      grid-template-columns: 2.15fr 0.85fr;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-width: 0;
    }
    .col--draft {
      gap: var(--sp-4);
    }
    .col-title {
      margin: 0;
    }
    .col-title--gap {
      margin-top: var(--sp-2);
    }
    .frame {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: zoom-in;
      width: 100%;
      color: var(--rr-ink);
      border-radius: var(--rr-r-sm);
    }
    .frames {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--sp-4);
    }
    .frames--two {
      grid-template-columns: 1fr 1fr;
    }
    .attach {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      margin-top: var(--sp-1);
    }
    .no-shot {
      aspect-ratio: 4 / 3;
      border-radius: var(--rr-r-sm);
      background: var(--rr-surface-2);
      border: 1px dashed var(--rr-line-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rr-ink-3);
      font-size: var(--fs-13);
    }
    .soft {
      color: var(--rr-ink-2);
    }
    .seen {
      font-weight: var(--fw-semibold);
      color: var(--rr-ink);
    }
    .refuse {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .draft {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      color: var(--rr-ink-2);
    }
    .draft__p {
      margin: 0;
    }
    .draft__p:first-child {
      color: var(--rr-ink);
      font-weight: var(--fw-medium);
    }
    .retest-draft {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      max-width: 640px;
    }
    .retest-draft__verdict {
      font-size: var(--fs-16);
      line-height: var(--lh-16);
      font-weight: var(--fw-semibold);
    }
    .col-title--decision {
      margin-bottom: 0;
    }
    .dev-ready {
      margin-top: var(--sp-2);
    }
    .cells {
      margin: 0;
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px var(--sp-3);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .cells dt {
      color: var(--rr-ink-2);
    }
    .cells dd {
      margin: 0;
    }
    .fix {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }
    .card__error {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-danger);
    }
    .card__foot {
      margin-top: var(--sp-6);
      padding-top: var(--sp-2);
      border-top: 1px solid var(--rr-line);
      display: flex;
      align-items: center;
      gap: var(--sp-4);
    }
    /* Служебная ссылка PM на trace прогона: справа, тихо, не кнопка решения. */
    .card__trace {
      margin-left: auto;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
      white-space: nowrap;
    }
    .denied {
      align-items: center;
      justify-content: center;
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
      color: var(--rr-ink-2);
      min-height: calc(100vh - 112px);
    }
    @media (max-width: 960px) {
      .grid,
      .grid--retest {
        grid-template-columns: 1fr;
      }
      .frames,
      .frames--two {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      .card {
        padding: var(--sp-4) var(--sp-4) var(--sp-3);
      }
      .card__n,
      .card__title {
        font-size: var(--fs-18);
        line-height: var(--lh-18);
      }
      .card__meta {
        margin-left: 0;
        flex-basis: 100%;
      }
      /* панель решения липнет к низу внутри потока: ничего не перекрывает */
      .col--decision {
        position: sticky;
        bottom: 0;
        z-index: var(--z-sheet);
        margin: 0 calc(-1 * var(--sp-4));
        padding: var(--sp-3) var(--sp-4);
        background: var(--rr-glass-bg);
        -webkit-backdrop-filter: blur(16px) saturate(140%);
        backdrop-filter: blur(16px) saturate(140%);
        border-top: 1px solid var(--rr-line);
      }
    }
    @media print {
      .card__back,
      rr-decision-panel,
      rr-phase-line,
      .card__foot,
      .attach {
        display: none !important;
      }
      .grid,
      .grid--retest {
        display: block;
      }
      .col {
        break-inside: avoid;
        margin-bottom: var(--sp-4);
      }
      .col--decision {
        display: none;
      }
      .card {
        box-shadow: none;
        border: 0;
        padding: 0;
      }
      .frame {
        cursor: default;
      }
    }
  `,
})
export class RemarkCardPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();
  readonly remarkId = input.required<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly triage = inject(TriageService);
  private readonly ws = inject(WsService);
  private readonly actions = inject(PendingActionService);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly copy = CARD;
  protected readonly traceLabel = PHASE_EXTRA.trace;
  protected readonly decision = DECISION;
  protected readonly empty = EMPTY;
  protected readonly newRemark = NEW_REMARK;
  protected readonly statusLabel = STATUS_LABEL;
  /** Поля «Допишите строку журнала»; «Где» предзаполняется ячейкой из файла. */
  protected readonly fixWhat = signal('');
  protected readonly fixWhere = signal('');

  protected readonly role = computed(() => this.session.roleIn(this.projectId()));
  protected readonly remark = computed<Remark | undefined>(() => this.store.byId(this.remarkId()));
  protected readonly viewer = signal<number | null>(null);
  /** Кто ещё в комнате замечания (presence из WS), кроме меня. */
  protected readonly presence = signal<Presence[]>([]);

  private readonly runSig = signal<TriageRun | null>(null);
  private fileAction: FileAction | null = null;
  private fileInput: HTMLInputElement | null = null;
  private leaveRoom: (() => void) | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const id = this.remarkId();
      untracked(() => {
        if (!this.store.round()) void this.store.enterRound(projectId, this.round());
        void this.store.loadRemark(projectId, id);
        this.joinRoom(projectId, id);
      });
    });
    // Сервер ответил, что прогон идёт (создание, «Прикрепить скрин», ретест): показываем фазы до события из комнаты.
    effect(() => {
      const remark = this.remark();
      untracked(() => {
        if (!remark) return;
        const run = this.triage.runFor(remark.id);
        if (remark.runStatus === 'running' && remark.runId && (!run || run.runId !== remark.runId || !run.analyzing())) {
          // После «Не та цитата» тот же run идёт заново с поиска: строка «Ищем другое место в ТЗ…», пока не пришла фаза.
          this.runSig.set(this.triage.start(remark, remark.runId, run?.rebinding() ? 'binding' : initialPhase(remark)));
        } else if (remark.runStatus !== 'running' && run?.analyzing() && run.runId === remark.runId) {
          run.finish(remark.status === 'awaiting_business_close' ? 'awaiting_business_close' : 'awaiting_pm');
        }
        if (!this.runSig() || this.runSig()!.remarkId !== remark.id) this.runSig.set(this.triage.runFor(remark.id) ?? null);
      });
    });
    // Нет сокета — перечитываем, пока сервер разбирает. С сокетом фазы приходят сами.
    effect(() => {
      const running = this.remark()?.runStatus === 'running';
      const offline = !this.ws.connected();
      untracked(() => this.pollFallback(running && offline));
    });
    effect(() => {
      const r = this.remark();
      if (r) this.title.setTitle(`${TITLE.remark(r.number, r.title)} — ${APP_NAME}`);
      if (r?.status === 'needs_human_parse' && r.pageOrScreen !== '—') untracked(() => this.fixWhere.update((w) => w || r.pageOrScreen));
    });
    this.destroyRef.onDestroy(() => {
      this.pollFallback(false);
      this.leaveRoom?.();
      this.leaveRoom = null;
    });
  }

  // ---------- комната замечания ----------

  private joinRoom(projectId: string, remarkId: string): void {
    this.leaveRoom?.();
    this.presence.set([]);
    this.leaveRoom = this.ws.join(
      projectId,
      remarkId,
      (e) => this.onEvent(remarkId, e),
      (ack) => this.onJoined(projectId, remarkId, ack),
    );
  }

  private onJoined(projectId: string, remarkId: string, ack: JoinAck): void {
    if (!ack.ok) return;
    const me = this.session.user()?.id;
    this.presence.set(ack.presence.filter((p) => p.userId !== me));
    const remark = this.remark();
    if (ack.runId && ack.phase && remark && ack.phase !== 'awaiting_pm' && ack.phase !== 'awaiting_business_close' && ack.phase !== 'persisted') {
      this.runSig.set(this.triage.start(remark, ack.runId, ack.phase));
    }
    // Между загрузкой и join сервер мог успеть записать результат.
    void this.store.loadRemark(projectId, remarkId);
  }

  private onEvent(remarkId: string, e: ServerEvent): void {
    if (e.type === 'presence') {
      const me = this.session.user()?.id;
      if (e.userId === me) return;
      this.presence.update((list) => {
        const rest = list.filter((p) => p.userId !== e.userId);
        return e.action === 'join' ? [...rest, { userId: e.userId, role: e.role, name: e.name }] : rest;
      });
      return;
    }
    const remark = this.remark();
    if (!remark) return;
    const run = this.triage.runFor(remarkId) ?? this.triage.idle(remark);
    this.runSig.set(run);
    if (run.applyEvent(e) === 'reload') void this.store.loadRemark(this.projectId(), remarkId);
  }

  private pollFallback(on: boolean): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (!on) return;
    this.poll = setInterval(() => void this.store.loadRemark(this.projectId(), this.remarkId()), FALLBACK_POLL_MS);
  }

  protected readonly watching = computed(() => {
    const list = this.presence();
    if (!list.length) return null;
    return list.map((p) => PRESENCE.watching(p.name, ROLE_GENITIVE[p.role])).join(' · ');
  });

  // ---------- доступ и режимы ----------

  protected readonly allowed = computed(() => {
    const r = this.remark();
    const role = this.role();
    if (!r || !role) return false;
    if (role === 'developer') return r.status === 'defect' || r.status === 'ready_for_retest';
    return true;
  });

  protected readonly running = computed(() => this.runSig()?.analyzing() ?? false);
  protected readonly failed = computed(() => this.runSig()?.failed() ?? false);
  protected readonly busy = computed(() => this.runSig()?.busy() ?? false);
  protected readonly quoteVisible = computed(() => this.runSig()?.quoteVisible() ?? true);
  protected readonly draftVisible = computed(() => this.runSig()?.draftVisible() ?? true);
  /** Черновик по мере печати моделью — только в колонке «Черновик разбора». */
  protected readonly streamed = computed(() => {
    const text = this.runSig()?.tokens() ?? '';
    return text ? text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  });
  /** Остановить прогон может тот, кто его запускает: pm или бизнес. */
  protected readonly stoppable = computed(() => {
    const role = this.role();
    return this.running() && !this.busy() && (role === 'pm' || role === 'business');
  });

  protected readonly pendingFor = computed<DecisionPending | null>(() => {
    const p = this.actions.pendingFor(this.remarkId());
    return p ? { label: p.label, committing: this.actions.committing() } : null;
  });

  protected readonly layout = computed<Layout>(() => {
    const r = this.remark()!;
    if (this.running()) return r.runMode === 'retest' && r.status === 'ready_for_retest' ? 'retest-wait' : 'running';
    if (r.status === 'needs_human_parse') return 'fix';
    if (r.status === 'cannot_tell') return 'refuse';
    if (r.status === 'ready_for_retest') return 'retest-wait';
    if ((r.status === 'awaiting_business_close' || r.status === 'closed') && r.retest) return 'retest';
    return 'draft';
  });

  protected readonly decisionMode = computed<DecisionMode | null>(() => {
    const r = this.remark()!;
    const role = this.role();
    if (this.running()) {
      if (r.runMode === 'retest') return role === 'business' ? 'retest-wait' : null;
      return role === 'pm' ? 'disabled' : null;
    }
    switch (role) {
      case 'pm':
      case 'admin':
        if (r.status === 'awaiting_pm') return r.proposedClass === 'unspecified' ? 'pm-two' : 'pm-full';
        if (r.status === 'triaging') return 'disabled';
        return r.verdict || r.status === 'closed' ? 'record' : null;
      case 'business':
        if (r.status === 'unspecified') return 'pm-two';
        if (r.status === 'cannot_tell') return 'attach';
        if (r.status === 'ready_for_retest') return 'retest-wait';
        if (r.status === 'awaiting_business_close') return 'retest';
        if (r.status === 'awaiting_pm' || r.status === 'triaging') return null;
        return r.verdict || r.status === 'closed' ? 'record' : null;
      case 'developer':
        return r.verdict ? 'record' : null;
      default:
        return null;
    }
  });

  protected readonly canFix = computed(() => this.role() === 'business' || this.role() === 'pm');

  protected readonly record = computed<DecisionRecord | null>(() => {
    const r = this.remark()!;
    if (r.status === 'closed') {
      return { label: DECISION.closedRecord, who: r.closedByName ?? '', at: r.closedAt ?? '', changeable: false };
    }
    if (!r.verdict) return null;
    const label = r.verdict.code === 'rejected_binding' ? STATUS_LABEL[r.status] : VERDICT_LABEL[r.verdict.code];
    return { label, who: r.verdict.userName ?? '', at: r.verdict.at, changeable: false };
  });

  protected readonly showPill = computed(() => {
    const s = this.remark()!.status;
    return !this.running() && s !== 'awaiting_pm' && s !== 'triaging';
  });

  protected readonly metaLine = computed(() => {
    const r = this.remark()!;
    const round = ROUND.label(r.roundNumber);
    if (r.status === 'ready_for_retest' || r.status === 'awaiting_business_close' || r.status === 'closed') {
      return `${CARD.fixedBy(r.fixedByName ?? '')} · ${round}`;
    }
    const journal = r.externalId ? ` · ${CARD.fromJournal(r.externalId)}` : '';
    return `${CARD.where} ${r.pageOrScreen} · ${CARD.addedBy(r.authorName ?? '')}${journal} · ${round}`;
  });

  // ---------- улики ----------

  protected readonly original = computed<Screenshot | null>(() => this.remark()!.screenshots.find((x) => x.kind === 'original') ?? null);

  protected readonly frames = computed<ViewerFrame[]>(() => {
    const shots = this.remark()!.screenshots;
    const original = shots.find((s) => s.kind === 'original');
    const retest = shots.find((s) => s.kind === 'retest');
    const diff = shots.find((s) => s.kind === 'diff');
    if (retest) {
      const frames: ViewerFrame[] = [];
      if (original) frames.push({ label: CARD.before, variant: original.variant ?? 'grey', src: original.url });
      frames.push({ label: CARD.after, variant: retest.variant ?? 'blue', src: retest.url });
      if (diff) frames.push({ label: CARD.diff, variant: diff.variant ?? 'diff', src: diff.url });
      return frames;
    }
    return original ? [{ label: CARD.frame, variant: original.variant ?? 'grey', src: original.url }] : [];
  });

  protected openViewer(index: number): void {
    this.viewer.set(index);
  }

  // ---------- черновик ----------

  protected readonly specCitation = computed(() => this.remark()!.citations.find((c) => c.source === 'spec') ?? null);
  protected readonly otherCitations = computed(() => this.remark()!.citations.filter((c) => c.source !== 'spec'));
  protected readonly documentsLink = computed(() => ['/p', this.projectId(), 'documents']);

  protected readonly retestVerdict = computed(() => {
    const r = this.remark()!;
    switch (r.retest?.outcome) {
      case 'likely_addressed':
        return CARD.likelyAddressed;
      case 'likely_unchanged':
        return CARD.likelyUnchanged;
      default:
        return r.screenshots.some((s) => s.kind === 'diff') ? CARD.diffReady : CARD.cannotCompare;
    }
  });

  // ---------- фазовая строка ----------

  protected readonly phaseText = computed(() => {
    const r = this.remark()!;
    const run = this.runSig();
    const role = this.role();
    if (run && (this.running() || run.busy())) {
      const phase: Phase = run.rebinding() && run.phase() === 'binding' ? 'rebinding' : run.phase();
      return PHASE_TEXT[phase];
    }
    if (this.failed()) return PHASE_TEXT.failed;
    switch (r.status) {
      case 'awaiting_pm':
        return role === 'pm' ? PHASE_TEXT.awaiting_pm : PHASE_EXTRA.awaitingPmOther;
      case 'unspecified':
        return role === 'business' ? PHASE_TEXT.awaiting_pm : PHASE_EXTRA.awaitingBusinessOther;
      case 'defect':
        return PHASE_EXTRA.inDevWith(r.fixedByName ?? 'разработчика');
      case 'cannot_tell':
        return PHASE_EXTRA.awaitingShot;
      case 'ready_for_retest':
        return PHASE_EXTRA.awaitingNewShot;
      case 'awaiting_business_close':
        return PHASE_TEXT.awaiting_business_close;
      case 'closed':
        return PHASE_EXTRA.closedAt(r.closedByName ?? '', r.closedAt ?? '');
      default:
        return STATUS_LABEL[r.status];
    }
  });

  protected readonly phaseTone = computed<PhaseTone>(() => {
    const s = this.remark()!.status;
    if (this.failed()) return 'muted';
    if (this.running()) return 'wait';
    if (s === 'defect') return 'work';
    if (s === 'closed' || s === 'change_request' || s === 'duplicate' || s === 'needs_human_parse') return 'muted';
    return 'wait';
  });

  protected readonly phasePulse = computed(() => this.phaseTone() === 'wait' && !this.failed());

  // ---------- действия: необратимые уходят через 5 секунд с «Отменить» ----------

  protected onVerdict(e: { code: Exclude<VerdictCode, 'rejected_binding'>; comment: string }): void {
    const id = this.remarkId();
    this.actions.schedule({ remarkId: id, label: VERDICT_LABEL[e.code], inline: true, commit: () => this.store.verdict(id, e.code, e.comment) });
  }

  protected onClose(): void {
    const id = this.remarkId();
    this.actions.schedule({ remarkId: id, label: DECISION.closeFixed, inline: true, commit: () => this.store.close(id) });
  }

  protected onNotFixed(): void {
    const id = this.remarkId();
    this.actions.schedule({ remarkId: id, label: DECISION.notFixed, inline: true, commit: () => this.store.notFixed(id) });
  }

  protected onReady(): void {
    const id = this.remarkId();
    this.actions.schedule({ remarkId: id, label: DECISION.readyForRetest, inline: true, commit: () => this.store.readyForRetest(id) });
  }

  protected undo(): void {
    this.actions.cancel();
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** «Допишите строку журнала»: обратимо по смыслу (дальше решает PM), поэтому без окна «Отменить». */
  protected async onFix(e: Event): Promise<void> {
    e.preventDefault();
    const remark = this.remark()!;
    const description = this.fixWhat().trim();
    if (!description) return;
    const where = this.fixWhere().trim();
    const updated = await this.store.fixRow(remark.id, { description, pageOrScreen: where || undefined });
    if (updated) {
      this.fixWhat.set('');
      this.fixWhere.set('');
    }
  }

  /** «Не та цитата» обратима по смыслу — идёт сразу, без отмены. Тот же run продолжает цикл bind. */
  protected async onRejectBinding(comment: string): Promise<void> {
    const remark = this.remark()!;
    const run = this.triage.idle(remark);
    this.runSig.set(run);
    if (run.busy()) return;
    run.busy.set(true);
    run.rebinding.set(true);
    run.quoteVisible.set(false);
    try {
      await this.store.rejectBinding(remark.id, comment);
    } finally {
      run.busy.set(false);
      if (!run.analyzing()) {
        run.rebinding.set(false);
        run.quoteVisible.set(true);
      }
    }
  }

  protected pickFile(action: FileAction): void {
    this.fileAction = action;
    this.fileInput ??= document.querySelector<HTMLInputElement>('rr-remark-card-page input[type=file]');
    this.fileInput?.click();
  }

  protected async onFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.fileAction) return;
    const action = this.fileAction;
    this.fileAction = null;
    const remark = this.remark()!;
    const run = this.triage.idle(remark);
    this.runSig.set(run);
    run.busy.set(true);
    try {
      if (action === 'attach') await this.store.attachShot(remark.id, file);
      else await this.store.retest(remark.id, file);
    } finally {
      run.busy.set(false);
    }
  }

  protected onRetry(): void {
    void this.store.triageAgain(this.remarkId());
  }

  protected async onStop(): Promise<void> {
    const run = this.runSig();
    if (!run || run.busy()) return;
    run.busy.set(true);
    try {
      await this.store.cancelRun(this.remarkId());
    } finally {
      run.busy.set(false);
    }
  }

  protected backLink(): unknown[] {
    return this.role() === 'developer' ? ['/p', this.projectId(), 'dev'] : ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round()];
  }
}
