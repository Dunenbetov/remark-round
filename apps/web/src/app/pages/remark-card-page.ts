import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Remark, Role, ShotVariant, VerdictCode } from '../core/models';
import { CARD, DECISION, EMPTY, PHASE_EXTRA, PHASE_TEXT, RETEST_EXPLANATION, STATUS_LABEL, VERDICT_LABEL } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { TriageRun, TriageService } from '../core/triage.service';
import { Citation } from '../ui/citation';
import { DecisionMode, DecisionPanel, DecisionRecord } from '../ui/decision-panel';
import { GlassHeader } from '../ui/glass-header';
import { PhaseLine, PhaseTone } from '../ui/phase-line';
import { Shot } from '../ui/shot';
import { ShotViewer, ViewerFrame } from '../ui/shot-viewer';
import { StatusPill } from '../ui/status-pill';

type Layout = 'running' | 'draft' | 'refuse' | 'retest-wait' | 'retest';

interface DraftPara {
  head: string;
  tail: string;
}

/**
 * Карточка замечания — главный экран. Три колонки на бумаге: Улики | Черновик разбора | Ваше решение.
 * Режим выбирается по статусу × роли (артборды 3, 4, 4а, 4б, 4в, 5, 5а, 12).
 */
@Component({
  selector: 'rr-remark-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GlassHeader, Shot, StatusPill, Citation, DecisionPanel, PhaseLine, ShotViewer],
  template: `
    @if (remark(); as r) {
      @if (allowed()) {
        <div class="page">
          <rr-glass-header [compact]="'Раунд ' + r.roundNumber + ' · № ' + r.number" />
          <main class="page__body card-body">
            <a class="link card__back" [routerLink]="backLink()">{{ role() === 'developer' ? copy.backDev : copy.back }}</a>
            <article class="paper card" [attr.data-status]="r.status">
              <header class="card__head">
                <span class="num card__n">№ {{ r.number }}</span>
                <h1 class="card__title">{{ r.title }}</h1>
                @if (showPill()) {
                  <rr-status-pill class="card__pill" [status]="r.status" />
                }
                <span class="meta card__meta">{{ metaLine() }}</span>
              </header>

              <div class="grid" [class.grid--retest]="layout() === 'retest'">
                <!-- УЛИКИ -->
                <section class="col col--evidence">
                  <h2 class="col-title">{{ copy.evidence }}</h2>
                  @if (layout() === 'retest' && frames().length === 3) {
                    <div class="frames">
                      @for (f of frames(); track f.variant) {
                        <button type="button" class="frame" (click)="openViewer(f.variant)">
                          <rr-shot [variant]="f.variant" [zoom]="true" />
                          <span class="meta">{{ f.label }}</span>
                        </button>
                      }
                    </div>
                  } @else if (originalShot(); as s) {
                    <button type="button" class="frame" (click)="openViewer(s)">
                      <rr-shot [variant]="s" [zoom]="true" />
                      @if (layout() === 'retest-wait' || layout() === 'retest') {
                        <span class="meta">{{ copy.before }}</span>
                      }
                    </button>
                    @if (layout() === 'retest-wait' && role() === 'business') {
                      <div class="attach">
                        <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="attachNewFrame()">{{ decision.attachShot }}</button>
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
                        <div class="draft" aria-live="polite">
                          @for (p of draftView(); track $index) {
                            <p class="draft__p">{{ p.head }}<span class="draft__tail">{{ p.tail }}</span></p>
                          }
                        </div>
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
                      [busy]="busy()"
                      [record]="record()"
                      [attachHint]="decision.attachFooterHint"
                      (verdict)="onVerdict($event)"
                      (rejectBinding)="onRejectBinding($event)"
                      (attach)="onAttach()"
                      (close)="onClose()"
                      (notFixed)="onNotFixed()"
                      (changeDecision)="onChangeDecision()"
                    />
                  } @else if (r.status === 'awaiting_pm' || r.status === 'triaging') {
                    <h2 class="col-title">{{ decision.title }}</h2>
                    <div class="soft">{{ copy.awaitingPmNote }}</div>
                  }
                  @if (role() === 'developer' && r.status === 'defect') {
                    <button type="button" class="btn btn--primary btn--left dev-ready" (click)="onReady()">{{ decision.readyForRetest }}</button>
                  }
                </section>
              </div>
            </article>
            <div class="card__spacer"></div>
            <rr-phase-line [text]="phaseText()" [tone]="phaseTone()" [pulse]="phasePulse()" [retryable]="failed()" (retry)="onRetry()" />
          </main>
          @if (viewer(); as v) {
            <rr-shot-viewer [title]="'№ ' + r.number + ' · ' + r.title" [frames]="frames()" [initial]="v" (closed)="viewer.set(null)" />
          }
        </div>
      } @else {
        <div class="page">
          <rr-glass-header [brandOnly]="true" />
          <main class="page__body denied">{{ empty.noAccess }}</main>
        </div>
      }
    } @else {
      <div class="page">
        <rr-glass-header [brandOnly]="true" />
        <main class="page__body denied">{{ empty.noAccess }}</main>
      </div>
    }
  `,
  styles: `
    .card-body {
      min-height: calc(100vh - 112px);
    }
    .card__back {
      display: inline-block;
      margin-bottom: 12px;
      align-self: flex-start;
    }
    .card {
      padding: 24px 28px 28px;
    }
    .card__head {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .card__n {
      font-size: 22px;
      line-height: 28px;
      font-weight: 600;
      color: var(--rr-ink-soft);
    }
    .card__title {
      margin: 0;
      font-size: 22px;
      line-height: 28px;
      font-weight: 600;
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
      gap: 28px;
      align-items: start;
    }
    .grid--retest {
      grid-template-columns: 2.15fr 0.85fr;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .col--draft {
      gap: 16px;
    }
    .col-title {
      margin: 0;
    }
    .col-title--gap {
      margin-top: 8px;
    }
    .frame {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: zoom-in;
      width: 100%;
      color: var(--rr-ink);
    }
    .frames {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
    }
    .attach {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .no-shot {
      aspect-ratio: 4 / 3;
      border-radius: 8px;
      background: var(--rr-surface-2);
      border: 1px dashed var(--rr-line);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rr-muted);
      font-size: 13px;
    }
    .soft {
      color: var(--rr-ink-soft);
    }
    .seen {
      font-weight: 600;
      color: var(--rr-ink);
    }
    .refuse {
      font-size: 15px;
      line-height: 22px;
      font-weight: 600;
    }
    .draft {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 80px;
    }
    .draft__p {
      margin: 0;
    }
    .draft__tail {
      color: var(--rr-muted);
    }
    .retest-draft {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 640px;
    }
    .retest-draft__verdict {
      font-size: 15px;
      line-height: 22px;
      font-weight: 600;
    }
    .col-title--decision {
      margin-bottom: 0;
    }
    .dev-ready {
      margin-top: 8px;
    }
    .card__spacer {
      height: 24px;
    }
    .denied {
      align-items: center;
      justify-content: center;
      font-size: 22px;
      line-height: 28px;
      font-weight: 600;
      color: var(--rr-ink-soft);
      min-height: calc(100vh - 112px);
    }
    @media (max-width: 960px) {
      .grid,
      .grid--retest {
        grid-template-columns: 1fr;
      }
      .frames {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      .card {
        padding: 16px;
      }
      .card__n,
      .card__title {
        font-size: 18px;
        line-height: 24px;
      }
      .card__meta {
        margin-left: 0;
        flex-basis: 100%;
      }
      .col-title--decision {
        display: none;
      }
      .card__spacer {
        height: 240px;
      }
    }
  `,
})
export class RemarkCardPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();
  readonly remarkId = input.required<string>();
  /** ?run=1 — проиграть прогон разбора заново (демо артборда 3). */
  readonly run = input<string>();

  private readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly triage = inject(TriageService);

  protected readonly copy = CARD;
  protected readonly decision = DECISION;
  protected readonly empty = EMPTY;

  protected readonly role = this.session.role;
  protected readonly remark = computed<Remark | undefined>(() => this.store.byId(this.remarkId()));
  protected readonly viewer = signal<ShotVariant | null>(null);

  private readonly runSig = signal<TriageRun | null>(null);
  private readonly startedFor = new Set<string>();

  constructor() {
    effect(() => {
      const id = this.remarkId();
      const status = this.remark()?.status;
      const wantRun = this.run() === '1';
      untracked(() => {
        const remark = this.store.byId(id);
        if (!remark) return;
        const key = `${id}:${wantRun ? 'q' : status}`;
        const shouldStart = (status === 'triaging' || wantRun) && !this.startedFor.has(key);
        if (shouldStart) {
          this.startedFor.add(key);
          this.runSig.set(this.triage.start(remark));
        } else {
          this.runSig.set(this.triage.runFor(id) ?? null);
        }
      });
    });
  }

  // ---------- доступ и режимы ----------

  protected readonly allowed = computed(() => {
    const r = this.remark();
    const role = this.role();
    if (!r || !role) return false;
    if (r.projectId !== this.projectId()) return false;
    if (role === 'developer') return r.status === 'defect' || r.status === 'ready_for_retest';
    return true;
  });

  protected readonly running = computed(() => this.runSig()?.analyzing() ?? false);
  protected readonly failed = computed(() => this.runSig()?.failed() ?? false);
  protected readonly busy = computed(() => this.runSig()?.busy() ?? false);
  protected readonly quoteVisible = computed(() => this.runSig()?.quoteVisible() ?? true);

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
        if (r.status === 'awaiting_pm') return r.proposedClass === 'unspecified' ? 'pm-two' : 'pm-full';
        if (r.status === 'triaging') return 'disabled';
        return 'record';
      case 'business':
        if (r.status === 'unspecified') return 'pm-two';
        if (r.status === 'cannot_tell') return 'attach';
        if (r.status === 'ready_for_retest') return 'retest-wait';
        if (r.status === 'awaiting_business_close') return 'retest';
        if (r.status === 'awaiting_pm' || r.status === 'triaging') return null;
        return 'record';
      case 'developer':
        return r.verdict ? 'record' : null;
      default:
        return null;
    }
  });

  protected readonly record = computed<DecisionRecord | null>(() => {
    const r = this.remark()!;
    const role = this.role();
    if (r.status === 'closed') {
      const who = this.name(r.closedByUserId);
      return { label: DECISION.closedRecord, who, at: r.closedAt ?? '', changeable: false };
    }
    if (!r.verdict) return null;
    const label = r.verdict.code === 'rejected_binding' ? STATUS_LABEL[r.status] : VERDICT_LABEL[r.verdict.code];
    const changeable = role === 'pm' && ['defect', 'change_request', 'unspecified', 'duplicate', 'cannot_tell'].includes(r.status);
    return { label, who: this.name(r.verdict.userId), at: r.verdict.at, changeable };
  });

  protected readonly showPill = computed(() => {
    const s = this.remark()!.status;
    return !this.running() && s !== 'awaiting_pm' && s !== 'triaging';
  });

  protected readonly metaLine = computed(() => {
    const r = this.remark()!;
    if (r.status === 'ready_for_retest' || r.status === 'awaiting_business_close' || r.status === 'closed') {
      return `${CARD.fixedBy(this.name(r.fixedByUserId))} · Раунд ${r.roundNumber}`;
    }
    return `${CARD.where} ${r.pageOrScreen} · ${CARD.addedBy(this.name(r.authorId))} · Раунд ${r.roundNumber}`;
  });

  // ---------- улики ----------

  protected readonly originalShot = computed<ShotVariant | null>(() => {
    const s = this.remark()!.screenshots.find((x) => x.kind === 'original');
    return s ? s.variant : null;
  });

  protected readonly frames = computed<ViewerFrame[]>(() => {
    const shots = this.remark()!.screenshots;
    if (shots.length === 3) {
      return [
        { label: CARD.before, variant: shots[0]!.variant },
        { label: CARD.after, variant: shots[1]!.variant },
        { label: CARD.diff, variant: shots[2]!.variant },
      ];
    }
    const original = this.originalShot();
    return original ? [{ label: CARD.frame, variant: original }] : [];
  });

  protected openViewer(variant: ShotVariant): void {
    this.viewer.set(variant);
  }

  // ---------- черновик ----------

  protected readonly specCitation = computed(() => this.remark()!.citations.find((c) => c.source === 'spec') ?? null);
  protected readonly otherCitations = computed(() => this.remark()!.citations.filter((c) => c.source !== 'spec'));
  protected readonly documentsLink = computed(() => ['/p', this.projectId(), 'documents']);

  protected readonly draftView = computed<DraftPara[]>(() => {
    const paras = this.remark()!.draft;
    const run = this.runSig();
    if (!run || !this.running()) return paras.map((p) => ({ head: p, tail: '' }));
    let left = run.typed();
    return paras.map((p) => {
      const words = p.split(' ');
      const n = Math.min(left, words.length);
      left -= n;
      const complete = n === words.length && left > 0;
      const cut = complete ? n : Math.max(0, n - 5);
      return { head: words.slice(0, cut).join(' ') + (cut < n ? ' ' : ''), tail: words.slice(cut, n).join(' ') };
    });
  });

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
    switch (r.status) {
      case 'awaiting_pm':
        return role === 'pm' ? PHASE_TEXT.awaiting_pm : PHASE_EXTRA.awaitingPmOther;
      case 'unspecified':
        return role === 'business' ? PHASE_TEXT.awaiting_pm : PHASE_EXTRA.awaitingBusinessOther;
      case 'defect':
        return PHASE_EXTRA.inDevWith(this.developerName());
      case 'cannot_tell':
        return PHASE_EXTRA.awaitingShot;
      case 'ready_for_retest':
        return PHASE_EXTRA.awaitingNewShot;
      case 'awaiting_business_close':
        return PHASE_TEXT.awaiting_business_close;
      case 'closed':
        return PHASE_EXTRA.closedAt(this.name(r.closedByUserId), r.closedAt ?? '');
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

  // ---------- действия ----------

  protected onVerdict(e: { code: Exclude<VerdictCode, 'rejected_binding'>; comment: string }): void {
    this.store.verdict(this.remarkId(), e.code, this.userId(), e.comment);
  }

  protected onRejectBinding(comment: string): void {
    const remark = this.remark()!;
    const run = this.triage.idle(remark);
    this.runSig.set(run);
    run.requote(() => this.store.rejectBinding(remark.id, this.userId(), comment));
  }

  protected onAttach(): void {
    this.store.attachShot(this.remarkId());
  }

  protected attachNewFrame(): void {
    const remark = this.remark()!;
    const run = this.triage.idle(remark);
    this.runSig.set(run);
    run.diff(() => this.store.completeRetest(remark.id, 'likely_addressed', RETEST_EXPLANATION));
  }

  protected onClose(): void {
    this.store.close(this.remarkId(), this.userId());
  }

  protected onNotFixed(): void {
    this.store.notFixed(this.remarkId());
  }

  protected onChangeDecision(): void {
    this.store.reopenDecision(this.remarkId());
  }

  protected onReady(): void {
    this.store.readyForRetest(this.remarkId(), this.userId());
  }

  protected onRetry(): void {
    this.runSig()?.retry();
  }

  protected backLink(): unknown[] {
    return this.role() === 'developer' ? ['/p', this.projectId(), 'dev'] : ['/p', this.projectId(), 'r', this.round()];
  }

  // ---------- helpers ----------

  private userId(): string {
    return this.session.user()?.id ?? '';
  }

  private name(userId: string | undefined): string {
    return userId ? (this.session.userById(userId)?.name ?? '') : '';
  }

  private developerName(): string {
    const r = this.remark()!;
    const dev = this.session.userById(r.fixedByUserId ?? '') ?? this.session.users.find((u) => u.role === ('developer' as Role));
    return dev?.name ?? '';
  }
}
