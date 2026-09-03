import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Remark, Screenshot, VerdictCode } from '../core/models';
import { APP_NAME, CARD, DECISION, EMPTY, PHASE_EXTRA, PHASE_TEXT, ROUND, STATUS_LABEL, TITLE, VERDICT_LABEL } from '../core/copy';
import { PendingActionService } from '../core/pending-action.service';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { TriageRun, TriageService } from '../core/triage.service';
import { AppBar } from '../ui/app-bar';
import { Citation } from '../ui/citation';
import { DecisionMode, DecisionPanel, DecisionPending, DecisionRecord } from '../ui/decision-panel';
import { PhaseLine, PhaseTone } from '../ui/phase-line';
import { Shot } from '../ui/shot';
import { ShotViewer, ViewerFrame } from '../ui/shot-viewer';
import { StatusPill } from '../ui/status-pill';

type Layout = 'running' | 'draft' | 'refuse' | 'retest-wait' | 'retest';
type FileAction = 'attach' | 'retest';

/** Пока сервер держит замечание в `triaging`, карточка перечитывает его раз в две секунды (до WS фазы 6). */
const POLL_MS = 2000;

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
                <rr-phase-line [text]="phaseText()" [tone]="phaseTone()" [pulse]="phasePulse()" [retryable]="failed()" (retry)="onRetry()" />
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
  /** ?run=1 — короткий показ фаз разбора (после «Сохранить» у бизнеса). */
  readonly run = input<string>();

  protected readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly triage = inject(TriageService);
  private readonly actions = inject(PendingActionService);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly copy = CARD;
  protected readonly decision = DECISION;
  protected readonly empty = EMPTY;

  protected readonly role = computed(() => this.session.roleIn(this.projectId()));
  protected readonly remark = computed<Remark | undefined>(() => this.store.byId(this.remarkId()));
  protected readonly viewer = signal<number | null>(null);

  private readonly runSig = signal<TriageRun | null>(null);
  private readonly startedFor = new Set<string>();
  private fileAction: FileAction | null = null;
  private fileInput: HTMLInputElement | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const id = this.remarkId();
      untracked(() => {
        if (!this.store.round()) void this.store.enterRound(projectId, this.round());
        void this.store.loadRemark(projectId, id);
      });
    });
    effect(() => {
      const id = this.remarkId();
      const remark = this.remark();
      const wantRun = this.run() === '1';
      untracked(() => {
        if (!remark) return;
        const key = `${id}:${wantRun ? 'q' : remark.status}`;
        const shouldStart = (remark.status === 'triaging' || wantRun) && !this.startedFor.has(key);
        if (shouldStart) {
          this.startedFor.add(key);
          this.runSig.set(this.triage.start(remark, wantRun));
        } else if (!this.runSig() || this.runSig()!.remarkId !== id) {
          this.runSig.set(this.triage.runFor(id) ?? null);
        }
      });
    });
    // Сервер вышел из `triaging` — показ фаз заканчивается, черновик проявляется.
    effect(() => {
      const status = this.remark()?.status;
      const run = this.runSig();
      untracked(() => {
        if (run && run.analyzing() && !run.demo && status && status !== 'triaging') run.finish();
      });
    });
    effect(() => {
      const triaging = this.remark()?.status === 'triaging';
      untracked(() => this.pollWhileTriaging(triaging));
    });
    effect(() => {
      const r = this.remark();
      if (r) this.title.setTitle(`${TITLE.remark(r.number, r.title)} — ${APP_NAME}`);
    });
    this.destroyRef.onDestroy(() => this.pollWhileTriaging(false));
  }

  /** До WS (фаза 6): пока сервер разбирает, перечитываем замечание. Один метод — одно место для замены. */
  private pollWhileTriaging(on: boolean): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (!on) return;
    this.poll = setInterval(() => void this.store.loadRemark(this.projectId(), this.remarkId()), POLL_MS);
  }

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

  protected readonly pendingFor = computed<DecisionPending | null>(() => {
    const p = this.actions.pendingFor(this.remarkId());
    return p ? { label: p.label, committing: this.actions.committing() } : null;
  });

  protected readonly layout = computed<Layout>(() => {
    const r = this.remark()!;
    if (this.running()) return 'running';
    if (r.status === 'cannot_tell') return 'refuse';
    if (r.status === 'ready_for_retest') return 'retest-wait';
    if ((r.status === 'awaiting_business_close' || r.status === 'closed') && r.retest) return 'retest';
    return 'draft';
  });

  protected readonly decisionMode = computed<DecisionMode | null>(() => {
    const r = this.remark()!;
    const role = this.role();
    if (this.running()) return role === 'pm' ? 'disabled' : null;
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
    return `${CARD.where} ${r.pageOrScreen} · ${CARD.addedBy(r.authorName ?? '')} · ${round}`;
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
    switch (this.remark()!.retest?.outcome) {
      case 'likely_addressed':
        return CARD.likelyAddressed;
      case 'likely_unchanged':
        return CARD.likelyUnchanged;
      default:
        return CARD.cannotCompare;
    }
  });

  // ---------- фазовая строка ----------

  protected readonly phaseText = computed(() => {
    const r = this.remark()!;
    const run = this.runSig();
    const role = this.role();
    if (run && (this.running() || run.busy())) return PHASE_TEXT[run.phase()];
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
    if (s === 'closed' || s === 'change_request' || s === 'duplicate') return 'muted';
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

  /** «Не та цитата» обратима по смыслу — идёт сразу, без отмены. */
  protected onRejectBinding(comment: string): void {
    const remark = this.remark()!;
    const run = this.triage.idle(remark);
    this.runSig.set(run);
    void run.requote(() => this.store.rejectBinding(remark.id, comment));
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
    if (action === 'attach') {
      await this.store.attachShot(remark.id, file);
      this.startedFor.clear();
      this.runSig.set(this.triage.start(this.remark()!, true));
      return;
    }
    const run = this.triage.idle(remark);
    this.runSig.set(run);
    void run.diff(() => this.store.retest(remark.id, file));
  }

  protected onRetry(): void {
    this.runSig()?.retry();
  }

  protected backLink(): unknown[] {
    return this.role() === 'developer' ? ['/p', this.projectId(), 'dev'] : ['/p', this.projectId(), 'r', this.store.roundNumber() ?? this.round()];
  }
}
