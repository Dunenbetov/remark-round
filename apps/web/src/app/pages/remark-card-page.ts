import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { JoinAck, Phase, Presence, Remark, RemarkHistoryEntry, Role, Screenshot, ServerEvent, VerdictCode } from '../core/models';
import { APP_NAME, CARD, DECISION, DEV_QUEUE, EMPTY, HISTORY_ACTION, NEW_REMARK, PHASE_EXTRA, PHASE_TEXT, PillTone, QUEUE, ROLE_SHORT, ROUND, STAMP_LABEL, STATUS_LABEL, TITLE, VERDICT_LABEL, statusLabelFor } from '../core/copy';
import { filterRemarks } from '../core/journal-filter';
import { PendingActionService } from '../core/pending-action.service';
import { QueueService } from '../core/queue.service';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { ShortcutsService } from '../core/shortcuts.service';
import { TriageRun, TriageService } from '../core/triage.service';
import { UiStateService } from '../core/ui-state.service';
import { WsService, initialPhase } from '../core/ws.service';
import { ApiService } from '../core/api.service';
import { links } from '../core/links';
import { AppBar } from '../ui/app-bar';
import { BrandMark } from '../ui/brand-mark';
import { CardHeader, HeaderStamp } from '../ui/card-header';
import { CardNav } from '../ui/card-nav';
import { Citation } from '../ui/citation';
import { CompareStage, StageFrame } from '../ui/compare-stage';
import { DecisionMode, DecisionNext, DecisionPanel, DecisionPending, DecisionRecord } from '../ui/decision-panel';
import { DropZone } from '../ui/drop-zone';
import { Icon } from '../ui/icons';
import { PhaseLine, PhaseTone } from '../ui/phase-line';
import { QueueRail, RailItem } from '../ui/queue-rail';
import { RunSteps } from '../ui/run-steps';
import { Shot } from '../ui/shot';
import { ShotViewer, ViewerFrame } from '../ui/shot-viewer';
import { dateTimeRu } from '../core/format';
import { ProcessStrip } from '../ui/process-strip';

/** fix — строка журнала без описания: человек дописывает её прямо на карточке. */
type Layout = 'running' | 'draft' | 'refuse' | 'retest-wait' | 'retest' | 'fix';
type FileAction = 'attach' | 'retest';

/** Без сокета (сеть, прокси) карточка перечитывает замечание, пока прогон идёт. С сокетом — только события. */
const FALLBACK_POLL_MS = 3000;

const STAMP_TONE: Record<VerdictCode, PillTone> = { defect: 'work', change_request: 'muted', unspecified: 'wait', cannot_tell: 'wait', duplicate: 'muted', rejected_binding: 'wait' };

/**
 * Карточка замечания — главный экран. Слева рельс очереди «i из N», на бумаге три колонки:
 * Замечание (на ретесте — Проверка) | Черновик разбора | Ваше решение. Режим выбирается по статусу × роли.
 * Данные и переходы — API; решения уходят через PendingActionService (5 секунд «Отменить»);
 * пока идёт отсчёт, переходы по очереди заблокированы.
 */
@Component({
  selector: 'rr-remark-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, AppBar, BrandMark, CardHeader, CardNav, Citation, CompareStage, DecisionPanel, DropZone, Icon, PhaseLine, QueueRail, RunSteps, Shot, ShotViewer, ProcessStrip],
  template: `
    @if (remark(); as r) {
      @if (allowed()) {
        <div class="page">
          <rr-app-bar [tabs]="false" />
          <main id="main" class="page__body page__body--wide card-body">
            <div class="layout" [class.layout--rail]="railItems().length > 0">
              @if (railItems().length) {
                <rr-queue-rail [label]="queueLabel()" [items]="railItems()" [activeId]="r.id" [locked]="locked()" (pick)="onRailPick($event)" />
              }
              <div class="main">
                <rr-card-nav
                  [backLink]="backLink()"
                  [backLabel]="backLabel()"
                  [queueLabel]="position() ? queueLabel() : null"
                  [index]="position()?.index ?? null"
                  [total]="position()?.total ?? null"
                  [hasPrev]="!!position()?.prevId"
                  [hasNext]="!!position()?.nextId"
                  [locked]="locked()"
                  (go)="go($event)"
                />
                <article class="paper card" [attr.data-status]="r.status">
                  <rr-card-header [number]="r.number" [title]="r.title" [status]="showPill() ? r.status : null" [role]="role()" [meta]="metaLine()" [presence]="presence()" [stamp]="headerStamp()" />
                  @if (role() === 'business' || role() === 'pm') {
                    <rr-process-strip class="card__strip" [current]="r.status" [role]="role()" [compact]="true" />
                  }

                  <div class="grid" [class.grid--retest]="twoCols()" [class.grid--noshot]="!original() && !twoCols()">
                    <!-- ЗАМЕЧАНИЕ / ПРОВЕРКА -->
                    <section class="col col--evidence">
                      <h2 class="col-title">{{ evidenceTitle() }}</h2>
                      @switch (layout()) {
                        @case ('retest') {
                          <rr-compare-stage [frames]="stageFrames()" [busy]="running()" [hint]="copy.diffHint" (open)="openViewer($event)" />
                        }
                        @case ('retest-wait') {
                          <div class="pair" [class.pair--two]="role() === 'business' || frames().length > 1">
                            @if (original(); as s) {
                              <button type="button" class="frame" [attr.aria-label]="copy.before + ' · ' + copy.zoomOpen" (click)="openViewer(0)">
                                <rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" [zoom]="true" />
                                <span class="meta">{{ copy.before }}</span>
                              </button>
                            }
                            @if (frames().length > 1) {
                              <button type="button" class="frame" [attr.aria-label]="copy.after + ' · ' + copy.zoomOpen" (click)="openViewer(1)">
                                <rr-shot [variant]="frames()[1].variant" [src]="frames()[1].src" [zoom]="true" />
                                <span class="meta">{{ copy.after }}</span>
                              </button>
                            } @else if (role() === 'business') {
                              <rr-drop-zone [title]="copy.attachNewFrameLong" [hint]="retestHint()" [busy]="busy()" [paste]="true" size="wide" (file)="onDropped('retest', $event)" />
                            }
                          </div>
                        }
                        @case ('refuse') {
                          @if (role() === 'business') {
                            <rr-drop-zone [title]="copy.attachShotLong" [hint]="decision.attachFooterHint" [busy]="busy()" [paste]="true" size="wide" (file)="onDropped('attach', $event)" />
                          } @else {
                            <div class="no-shot"><rr-icon name="image" [size]="16" /> {{ copy.noShotShort }}</div>
                          }
                          <ng-container *ngTemplateOutlet="said" />
                        }
                        @case ('fix') {
                          <div class="blank">
                            <div class="in-label">{{ r.externalId ? copy.fromJournal(r.externalId) : copy.saidBy }}</div>
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
                          </div>
                        }
                        @default {
                          @if (original(); as s) {
                            <button type="button" class="frame" [attr.aria-label]="copy.frame + ' · ' + copy.zoomOpen" (click)="openViewer(0)">
                              <rr-shot [variant]="s.variant ?? 'grey'" [src]="s.url" [zoom]="true" />
                            </button>
                          } @else {
                            <div class="no-shot"><rr-icon name="image" [size]="16" /> {{ copy.noShotShort }}</div>
                          }
                          <ng-container *ngTemplateOutlet="said" />
                        }
                      }
                      @if (layout() === 'retest') {
                        <ng-container *ngTemplateOutlet="said" />
                      }
                    </section>

                    <!-- ЧЕРНОВИК РАЗБОРА / ЧТО ТРЕБУЕТ ТЗ -->
                    @if (!twoCols()) {
                      <section class="col col--draft">
                        <h2 class="col-title">
                          {{ role() === 'developer' && r.status !== 'awaiting_pm' ? copy.specRequires : copy.draft }}
                          @if (byRules()) {
                            <span class="pill pill--muted col-title__pill" [attr.title]="copy.draftByRules">{{ copy.draftByRules }}</span>
                          }
                        </h2>
                        @if (running() && r.runMode !== 'retest') {
                          <rr-run-steps [hasShot]="!!original()" [phase]="phase()" [text]="phaseText()" />
                        }
                        @switch (layout()) {
                          @case ('fix') {
                            <div class="lead">{{ empty.importUnparsed }}</div>
                            <div class="soft">{{ copy.fixRowHint }}</div>
                          }
                          @case ('refuse') {
                            <div class="lead">{{ copy.refuse }}</div>
                            <div class="soft">{{ copy.refuseWhy }}</div>
                            @if (specCitation(); as c) {
                              <rr-citation [citation]="c" [documentsLink]="documentsLink()" />
                            }
                          }
                          @case ('retest-wait') {
                            @if (specCitation(); as c) {
                              <rr-citation [citation]="c" [documentsLink]="documentsLink()" />
                            }
                            <div class="soft">{{ copy.compareHint }}</div>
                          }
                          @default {
                            <!-- вывод черновика — первым: это предмет решения; кадр и цитаты — ниже как подтверждение -->
                            @if (!running() && visibleDraft().length) {
                              <p class="draft__p lead draft__lead fade" [style.opacity]="draftVisible() ? 1 : 0" aria-live="polite">{{ visibleDraft()[0] }}</p>
                            }
                            @if (r.seen) {
                              <div class="soft"><span class="seen">{{ copy.seen }}</span> {{ r.seen }}</div>
                            }
                            <!-- заказчик до решения: черновика и цитат ему не показываем (ADR 007), а не пустую колонку -->
                            @if (customerWaiting()) {
                              <div class="soft">{{ copy.customerWaiting }}</div>
                            }
                            @if (draftShown()) {
                              @if (specCitation(); as c) {
                                <rr-citation [citation]="c" [documentsLink]="documentsLink()" [visible]="quoteVisible()" />
                              } @else if (noSpecNote()) {
                                <div class="soft">{{ copy.noSpecCitation }}</div>
                              }
                              @for (c of otherCitations(); track c.id) {
                                <rr-citation [citation]="c" />
                              }
                            }
                            @if (!running()) {
                              <div class="draft fade" [style.opacity]="draftVisible() ? 1 : 0">
                                @for (p of visibleDraft(); track $index; let i = $index) {
                                  @if (i > 0) {
                                    <p class="draft__p rise" [style.--i]="i">{{ p }}</p>
                                  }
                                }
                                @if (role() === 'developer' && r.draft.length > 1) {
                                  <button type="button" class="btn btn--text draft__more" (click)="fullDraft.set(!fullDraft())">{{ fullDraft() ? copy.hideFullDraft : copy.showFullDraft }}</button>
                                }
                              </div>
                            } @else if (streamed().length) {
                              <div class="draft draft--stream" aria-live="polite">
                                @for (p of streamed(); track $index) {
                                  <p class="draft__p fade-in">{{ p }}</p>
                                }
                              </div>
                            }
                          }
                        }
                      </section>
                    }

                    <!-- ВАШЕ РЕШЕНИЕ -->
                    <section class="col col--decision">
                      @if (layout() === 'retest-wait') {
                        <h2 class="col-title">{{ copy.draft }}</h2>
                        <div class="retest-draft">
                          @if (specCitation(); as c) {
                            <rr-citation [citation]="c" [documentsLink]="documentsLink()" />
                          }
                          <div class="soft">{{ copy.compareHint }}</div>
                        </div>
                      }
                      @if (layout() === 'retest') {
                        <h2 class="col-title">{{ copy.draft }}</h2>
                        <div class="retest-draft">
                          <div class="lead">{{ retestVerdict() }}</div>
                          @if (r.retest?.explanation; as ex) {
                            <div class="soft">{{ ex }}</div>
                          }
                          @if (specCitation(); as c) {
                            <rr-citation class="retest-draft__cite" [citation]="c" [documentsLink]="documentsLink()" />
                          }
                        </div>
                      }
                      @if (decisionMode(); as mode) {
                        <h2 class="col-title col-title--decision">{{ mode === 'dev-advice' ? decision.adviseTitle : decision.title }}</h2>
                        <rr-decision-panel
                          [mode]="mode"
                          [busy]="busy() || store.loading()"
                          [record]="recordView()"
                          [reopenLabel]="reopenLabel()"
                          (reopen)="onReopen()"
                          [pending]="pendingFor()"
                          [remarkId]="r.id"
                          [next]="panelNext()"
                          [queueEmpty]="queueEmpty()"
                          [attachHint]="decision.attachFooterHint"
                          [advice]="r.advice ?? []"
                          [myUserId]="myUserId()"
                          [adviceTick]="adviceTick()"
                          (advise)="onAdvise($event)"
                          (retractAdvice)="onRetractAdvice()"
                          (verdict)="onVerdict($event)"
                          (rejectBinding)="onRejectBinding($event)"
                          (attach)="pickFile('attach')"
                          (close)="onClose($event)"
                          (notFixed)="onNotFixed()"
                          (undo)="undo()"
                          (goNext)="goNextTarget()"
                          (toJournal)="toBack()"
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
                          <button type="submit" class="btn btn--primary btn--lg btn--left" [class.btn--busy]="store.loading()" [disabled]="store.loading() || !fixWhat().trim()">{{ newRemark.save }}</button>
                        </form>
                      }

                      @if (role() === 'developer' && r.status === 'defect') {
                        @if (devTodo().length) {
                          <div class="todo">
                            <div class="in-label">{{ copy.whatToDo }}</div>
                            @for (line of devTodo(); track line) {
                              <div class="todo__line">{{ line }}</div>
                            }
                          </div>
                        }
                        @if (!pendingFor()) {
                          <button type="button" class="btn btn--primary btn--lg btn--left dev-ready" [class.is-pressed]="pressed() === 'Digit1'" [disabled]="store.loading()" (click)="onReady()">
                            {{ decision.readyForRetest }}<span class="kbd">1</span>
                          </button>
                          <div class="keys meta">{{ decision.keysHintDev }}</div>
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
                      <a class="link card__trace" [href]="r.traceUrl" target="_blank" rel="noopener">{{ traceLabel }} <rr-icon name="external" [size]="12" /></a>
                    }
                  </footer>
                  <!-- История — дело целиком (ADR 011): на закрытом замечании раскрыта сразу, это главное, что на нём читают -->
                  <details class="history" [open]="r.status === 'closed'" (toggle)="onHistoryToggle($event)">
                    <summary class="history__summary">{{ copy.history }}</summary>
                    @if (historyLoading()) {
                      <p class="meta history__note">…</p>
                    } @else if (!history().length) {
                      <p class="meta history__note">{{ copy.historyEmpty }}</p>
                    } @else {
                      <ol class="history__list">
                        @for (e of history(); track e.id) {
                          <li class="history__row">
                            <time class="history__when" [attr.datetime]="e.at">{{ when(e.at) }}</time>
                            <div class="history__what">
                              <span class="history__who">{{ e.by ? person(e.by.name, e.by.role) : copy.historySystem }}</span>
                              <span>{{ actionLabel(e) }}</span>
                              @if (e.fromStatus !== e.toStatus) {
                                <span class="history__to">→ {{ statusLabelFor(e.toStatus, role()) }}</span>
                              }
                              @if (e.detail) {
                                <span class="meta history__detail">{{ e.detail }}</span>
                              }
                              @if (e.comment) {
                                <span class="history__comment">«{{ e.comment }}»</span>
                              }
                              @if (e.shot; as shot) {
                                <button type="button" class="btn btn--text history__shot" (click)="openHistoryShot(e)">
                                  {{ copy.historyShot[shot.kind] }}@if (!shot.current) {<span class="meta"> · {{ copy.historyShotReplaced }}</span>}
                                </button>
                              }
                            </div>
                          </li>
                        }
                      </ol>
                    }
                  </details>
                </article>
              </div>
            </div>
          </main>
          <input #file type="file" class="visually-hidden" accept="image/*" (change)="onFile($event)" />
          @if (viewer() !== null) {
            <rr-shot-viewer [title]="'№ ' + r.number + ' · ' + r.title" [frames]="frames()" [initial]="viewer()!" (closed)="viewer.set(null)" />
          }
          @if (historyShot(); as hs) {
            <rr-shot-viewer [title]="'№ ' + r.number + ' · ' + hs.title" [frames]="[hs.frame]" (closed)="historyShot.set(null)" />
          }
        </div>
      } @else {
        <ng-container *ngTemplateOutlet="denied" />
      }
    } @else if (!store.loading()) {
      <ng-container *ngTemplateOutlet="denied" />
    }

    <!-- «Что написал заказчик»: описание, где, как должно быть, важность — то, что человек написал сам. -->
    <ng-template #said>
      @if (saidLines().length) {
        <div class="said">
          <div class="in-label">{{ copy.saidBy }}</div>
          <dl class="cells">
            @for (l of saidLines(); track l.dt) {
              <dt>{{ l.dt }}</dt>
              <dd [class.cells__quote]="l.quote">{{ l.dd }}</dd>
            }
          </dl>
        </div>
      }
    </ng-template>

    <ng-template #denied>
      <div class="page">
        <rr-app-bar [brandOnly]="true" />
        <main id="main" class="page__body denied">
          <div class="paper denied__box">
            <rr-brand-mark [size]="40" tone="danger" />
            <div class="denied__title">{{ empty.noAccess }}</div>
            <a class="btn btn--secondary" [routerLink]="backLink()">{{ copy.toJournal }}</a>
          </div>
        </main>
      </div>
    </ng-template>
  `,
  styles: `
    .card-body {
      margin-bottom: var(--sp-8);
    }
    .layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--sp-6);
      align-items: start;
    }
    .layout--rail {
      grid-template-columns: var(--rr-rail-w) minmax(0, 1fr);
    }
    /* рельс начинается на уровне бумаги, а не строки навигации */
    .layout--rail rr-queue-rail {
      margin-top: 48px;
    }
    .main {
      min-width: 0;
    }
    .card {
      padding: var(--sp-7) var(--sp-7) var(--sp-4);
    }
    /* схема пути: где сейчас это замечание (бизнес и PM) */
    .card__strip {
      display: block;
      margin: calc(-1 * var(--sp-3)) 0 var(--sp-5);
    }
    .card__hint {
      margin: calc(-1 * var(--sp-2)) 0 var(--sp-5);
    }
    .grid {
      display: grid;
      grid-template-columns: 1.1fr 1fr 0.9fr;
      gap: var(--sp-6);
      align-items: start;
    }
    .grid--noshot {
      grid-template-columns: 0.9fr 1.2fr 0.9fr;
    }
    .grid--retest {
      grid-template-columns: 2.1fr 0.9fr;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .col--draft {
      gap: var(--sp-4);
    }
    .col-title__pill {
      margin-left: var(--sp-2);
      vertical-align: middle;
      font-weight: var(--fw-medium);
    }
    .col-title {
      margin: 0;
    }
    .col-title--decision {
      margin-bottom: 0;
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
      border-radius: var(--rr-r-md);
    }
    .frame rr-shot {
      aspect-ratio: 16 / 10;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--sp-4);
    }
    .pair--two {
      grid-template-columns: 1fr 1fr;
    }
    .no-shot {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      min-height: 40px;
      padding: 0 var(--sp-3);
      border-radius: var(--rr-r-md);
      background: var(--rr-surface-2);
      border: 1px dashed var(--rr-line-strong);
      color: var(--rr-ink-3);
      font-size: var(--fs-13);
      width: 100%;
    }
    .said,
    .blank {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
      border-radius: var(--rr-r-md);
      background: var(--rr-surface-2);
    }
    /* Подпись блока внутри бумаги. Капс с разрядкой на карточке носят только заголовки колонок. */
    .in-label {
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      font-weight: var(--fw-medium);
      color: var(--rr-ink-3);
    }
    .cells {
      margin: 0;
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px var(--sp-3);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .cells dt {
      color: var(--rr-ink-2);
    }
    .cells dd {
      margin: 0;
    }
    .cells__quote {
      font-size: var(--fs-15);
      line-height: var(--lh-15);
      font-weight: var(--fw-medium);
    }
    .soft {
      color: var(--rr-ink-2);
    }
    .seen {
      font-weight: var(--fw-semibold);
      color: var(--rr-ink);
    }
    .draft {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      color: var(--rr-ink-2);
      max-width: 68ch;
    }
    .draft__p {
      margin: 0;
    }
    .draft__p.lead {
      color: var(--rr-ink);
    }
    .draft--stream {
      color: var(--rr-ink-2);
    }
    .draft__more {
      align-self: flex-start;
    }
    .retest-draft {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      margin-bottom: var(--sp-3);
    }
    .todo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: var(--sp-3) var(--sp-4);
      border-radius: var(--rr-r-md);
      background: var(--rr-surface-2);
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }
    .todo .in-label {
      margin-bottom: 2px;
    }
    .dev-ready {
      margin-top: var(--sp-2);
      justify-content: space-between;
    }
    .keys {
      color: var(--rr-ink-3);
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
    .history {
      margin-top: var(--sp-3);
      border-top: 1px solid var(--rr-line);
      padding-top: var(--sp-3);
    }
    .history__summary {
      cursor: pointer;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
      list-style: none;
    }
    .history__summary::-webkit-details-marker {
      display: none;
    }
    .history__summary::before {
      content: '▸ ';
    }
    .history[open] .history__summary::before {
      content: '▾ ';
    }
    .history__note {
      margin: var(--sp-2) 0 0;
    }
    .history__list {
      list-style: none;
      margin: var(--sp-2) 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
    }
    .history__row {
      display: grid;
      grid-template-columns: 21ch minmax(0, 1fr);
      gap: var(--sp-3);
      font-size: var(--fs-13);
      line-height: var(--lh-13);
    }
    .history__when {
      color: var(--rr-ink-3);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .history__what {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--sp-2);
      min-width: 0;
    }
    .history__who {
      font-weight: var(--fw-medium);
    }
    .history__to {
      color: var(--rr-ink-2);
    }
    .history__detail {
      flex-basis: 100%;
      overflow-wrap: anywhere;
    }
    /* кадр действия — тихая текстовая кнопка в строке */
    .history__shot {
      padding: 0;
      min-height: 0;
      font-size: inherit;
      line-height: inherit;
    }
    @media (max-width: 900px) {
      .history__row {
        grid-template-columns: minmax(0, 1fr);
        gap: 2px;
      }
    }
    /* слова человека — как комментарий записи решения: курсив, вторичный цвет */
    .history__comment {
      flex-basis: 100%;
      color: var(--rr-ink-2);
      font-style: italic;
      overflow-wrap: anywhere;
    }
    .card__trace {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--fs-13);
      line-height: var(--lh-13);
      color: var(--rr-ink-2);
      white-space: nowrap;
    }
    .denied {
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 120px);
    }
    .denied__box {
      width: min(480px, 100%);
      padding: var(--sp-8) var(--sp-6);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-4);
      text-align: center;
      color: var(--rr-ink);
    }
    .denied__title {
      font-size: var(--fs-22);
      line-height: var(--lh-22);
      font-weight: var(--fw-semibold);
    }
    @media (max-width: 1279px) {
      .layout--rail {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 900px) {
      .card {
        padding: var(--sp-4) var(--sp-4) var(--sp-3);
      }
      .grid,
      .grid--retest,
      .grid--noshot {
        grid-template-columns: 1fr;
      }
      .pair--two {
        grid-template-columns: 1fr;
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
      rr-card-nav,
      rr-queue-rail,
      rr-decision-panel,
      rr-phase-line,
      .card__foot,
      .dev-ready,
      .keys {
        display: none !important;
      }
      .layout,
      .grid,
      .grid--retest,
      .grid--noshot {
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
  private readonly queue = inject(QueueService);
  private readonly ui = inject(UiStateService);
  private readonly shortcuts = inject(ShortcutsService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ApiService);
  private readonly panel = viewChild(DecisionPanel);

  protected readonly copy = CARD;
  protected readonly traceLabel = PHASE_EXTRA.trace;
  protected readonly decision = DECISION;
  protected readonly empty = EMPTY;
  protected readonly newRemark = NEW_REMARK;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusLabelFor = statusLabelFor;
  protected readonly pressed = this.shortcuts.pressed;
  /** История переходов (аудит: remark-history): грузится при раскрытии и перечитывается при каждом изменении карточки. */
  protected readonly history = signal<RemarkHistoryEntry[]>([]);
  protected readonly historyLoading = signal(false);
  private historyOpen = false;
  /** Поля «Допишите строку журнала»; «Где» предзаполняется ячейкой из файла. */
  protected readonly fixWhat = signal('');
  protected readonly fixWhere = signal('');
  /** Разработчику черновик показываем первым абзацем; целиком — по кнопке. */
  protected readonly fullDraft = signal(false);
  /** Совет разработчика: мой id для «Ваш совет» и метка события remark.advice для pop бейджа. */
  protected readonly myUserId = computed(() => this.session.user()?.id ?? null);
  protected readonly adviceTick = signal(0);

  protected readonly role = computed(() => this.session.roleIn(this.projectId()));
  protected readonly remark = computed<Remark | undefined>(() => this.store.byId(this.remarkId()));
  protected readonly viewer = signal<number | null>(null);
  /** Кадр строки истории, открытый в просмотрщике. */
  protected readonly historyShot = signal<{ title: string; frame: ViewerFrame } | null>(null);
  /** Кто ещё в комнате замечания (presence из WS), кроме меня. */
  protected readonly presence = signal<Presence[]>([]);
  private readonly runSig = signal<TriageRun | null>(null);
  private fileAction: FileAction | null = null;
  private fileInput: HTMLInputElement | null = null;
  private leaveRoom: (() => void) | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const r = this.remark();
      if (r && this.historyOpen) untracked(() => void this.loadHistory());
    });
    effect(() => {
      const projectId = this.projectId();
      const id = this.remarkId();
      untracked(() => {
        if (!this.store.round()) void this.store.enterRound(projectId, this.round());
        // Разработчик пришёл по ссылке: рельсу нужны обе его очереди.
        if (this.role() === 'developer') {
          if (!this.store.devQueue().length) void this.store.loadDevQueue(projectId);
          if (!this.store.advisoryQueue().length) void this.store.loadAdvisoryQueue(projectId);
        }
        void this.store.loadRemark(projectId, id);
        this.joinRoom(projectId, id);
        // та же страница, другая карточка: локальное состояние не переезжает
        this.viewer.set(null);
        this.fixWhat.set('');
        this.fixWhere.set('');
        this.fullDraft.set(false);
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
    // Разработчику рельс строится из его очереди — подгружаем, если пришли по прямой ссылке.
    effect(() => {
      const projectId = this.projectId();
      const role = this.role();
      untracked(() => {
        if (role === 'developer' && !this.store.devQueue().length) void this.store.loadDevQueue(projectId);
      });
    });

    const unbind = this.shortcuts.bind({
      Digit1: () => this.onKeyDigit(1),
      Digit2: () => this.onKeyDigit(2),
      Digit3: () => this.onKeyDigit(3),
      Digit4: () => this.onKeyDigit(4),
      Digit5: () => this.onKeyDigit(5),
      Escape: () => this.pendingFor() && this.undo(),
      ArrowRight: () => this.go('next'),
      KeyJ: () => this.go('next'),
      ArrowLeft: () => this.go('prev'),
      KeyK: () => this.go('prev'),
      KeyC: () => this.panel()?.openComment(),
      KeyO: () => this.frames().length && this.openViewer(0),
      KeyU: () => this.onKeyUpload(),
    });

    this.destroyRef.onDestroy(() => {
      unbind();
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
    if (e.type === 'remark.advice') {
      // Совет разработчика — не прогон: обновляем список советов на месте, бейдж у варианта делает pop.
      this.store.applyAdvice(e.remarkId, e.advice);
      this.adviceTick.set(Date.now());
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

  // ---------- очередь и рельс ----------

  /** Список замечаний, из которого строится рельс: раунд у PM/бизнеса, очередь у разработчика. */
  private readonly pool = computed<Remark[]>(() => (this.role() === 'developer' ? [...this.store.devQueue(), ...this.store.advisoryQueue()] : this.store.remarks()));

  /** id очереди: снимок из журнала/очереди, если текущая карточка в нём; иначе фолбэк по роли. */
  protected readonly queueIds = computed<string[]>(() => {
    const id = this.remarkId();
    const snap = this.queue.snapshot();
    if (snap && snap.ids.includes(id)) return snap.ids;
    const role = this.role();
    const pool = this.pool();
    const advisory = role === 'developer' && this.remark()?.status === 'awaiting_pm';
    const ids = (
      role === 'developer'
        ? pool.filter((r) => (advisory ? r.status === 'awaiting_pm' : r.status === 'defect') || r.id === id)
        : filterRemarks(pool, 'Ждут меня', role)
    ).map((r) => r.id);
    return ids.includes(id) ? ids : [];
  });

  protected readonly queueLabel = computed(() => {
    const snap = this.queue.snapshot();
    if (snap && snap.ids.includes(this.remarkId())) return snap.label;
    if (this.role() === 'developer') return this.remark()?.status === 'awaiting_pm' ? DEV_QUEUE.advisoryQueue : QUEUE.dev;
    return QUEUE.title;
  });

  protected readonly position = computed(() => this.queue.position(this.remarkId(), this.queueIds()));

  private isDone(r: Remark): boolean {
    const role = this.role();
    if (role === 'developer') {
      if (r.status === 'awaiting_pm') return !!r.advice?.some((a) => a.userId === this.myUserId());
      return r.status !== 'defect';
    }
    return filterRemarks([r], 'Ждут меня', role).length === 0;
  }

  protected readonly railItems = computed<RailItem[]>(() => {
    const ids = this.queueIds();
    if (ids.length < 2) return [];
    const byId = new Map(this.pool().map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id) ?? (id === this.remarkId() ? this.remark() : undefined))
      .filter((r): r is Remark => !!r)
      .map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status, link: this.cardLinkFor(r), done: this.isDone(r) }));
  });

  /** Следующая нерешённая карточка после текущей (или первая нерешённая до неё). */
  protected readonly nextTarget = computed<DecisionNext | null>(() => {
    const items = this.railItems();
    const i = items.findIndex((x) => x.id === this.remarkId());
    if (i < 0) return null;
    const after = items.slice(i + 1).find((x) => !x.done) ?? items.slice(0, i).find((x) => !x.done);
    return after ? { n: after.number, title: after.title } : null;
  });
  protected readonly queueEmpty = computed(() => this.railItems().length > 0 && !this.nextTarget());
  /** Разработчику «Следующее» показываем только после «Готово»; до этого его кнопка — сама работа. */
  protected readonly panelNext = computed(() => (this.role() === 'developer' && this.remark()?.status === 'defect' ? null : this.nextTarget()));
  /** Ретест и ожидание кадра — две колонки: сцена сравнения шире, черновик переезжает в колонку решения. */
  protected readonly twoCols = computed(() => this.layout() === 'retest' || this.layout() === 'retest-wait');
  /** Заголовок левой колонки — шаг строки пути: «Замечание», а пока идёт проверка исправления — «Проверка». */
  protected readonly evidenceTitle = computed(() => (this.twoCols() ? CARD.columnCheck : CARD.columnRemark));
  /** Идёт 5-секундный отсчёт — переходы по очереди заблокированы, иначе решение уйдёт мгновенно. */
  protected readonly locked = computed(() => !!this.pendingFor());

  /** Строки copy.ts начинаются со стрелки — в card-nav её рисует иконка. */
  protected readonly backLabel = computed(() => (this.role() === 'developer' ? CARD.backDev : CARD.back).replace(/^←\s*/, ''));

  protected readonly backLink = computed<(string | number)[]>(() => {
    const snap = this.queue.snapshot();
    if (snap && snap.ids.includes(this.remarkId())) return snap.backLink;
    return this.role() === 'developer' ? links.dev(this.slug()) : links.journal(this.slug(), this.store.roundNumber() ?? this.round());
  });

  private readonly slug = computed(() => this.session.slugOf(this.projectId()));

  /** /klientskiy-kabinet/round-2/12 — номер замечания уникален в раунде. */
  private cardLinkFor(r: Pick<Remark, 'number' | 'roundNumber'>): string[] {
    return links.remark(this.slug(), r.roundNumber || this.store.roundNumber() || this.round(), r.number);
  }

  protected go(dir: 'prev' | 'next'): void {
    const pos = this.position();
    if (!pos || this.locked()) return;
    const id = dir === 'next' ? pos.nextId : pos.prevId;
    if (id) this.openById(id);
  }

  protected goNextTarget(): void {
    const target = this.nextTarget();
    if (!target) return;
    const item = this.railItems().find((x) => x.number === target.n);
    if (item) this.openById(item.id);
  }

  protected onRailPick(id: string): void {
    this.ui.lastRemarkId.set(id);
  }

  private openById(id: string): void {
    const item = this.railItems().find((x) => x.id === id);
    if (!item) return;
    this.ui.lastRemarkId.set(id);
    void this.router.navigate(item.link);
  }

  protected toBack(): void {
    void this.router.navigate(this.backLink());
  }

  // ---------- клавиши ----------

  private onKeyDigit(n: number): void {
    const r = this.remark();
    if (!r || this.locked()) return;
    const mode = this.decisionMode();
    if (mode === 'pm-full' || mode === 'pm-two' || mode === 'dev-advice') {
      this.panel()?.pickByKey(n);
      return;
    }
    if (mode === 'retest' || mode === 'retest-check') {
      // Панель знает комментарий к закрытию и какие кнопки сейчас доступны
      this.panel()?.retestByKey(n);
      return;
    }
    if (this.role() === 'developer' && r.status === 'defect' && n === 1) this.onReady();
  }

  private onKeyUpload(): void {
    const mode = this.decisionMode();
    if (mode === 'attach') this.pickFile('attach');
    else if (mode === 'retest-check' && this.role() === 'business') this.pickFile('retest');
  }

  // ---------- доступ и режимы ----------

  protected readonly allowed = computed(() => {
    const r = this.remark();
    const role = this.role();
    if (!r || !role) return false;
    // Разработчик читает и то, что ждёт PM (awaiting_pm) — чтобы посоветовать; API отдаёт такие карточки по id.
    if (role === 'developer') return r.status === 'defect' || r.status === 'ready_for_retest' || r.status === 'awaiting_pm';
    return true;
  });

  protected readonly running = computed(() => this.runSig()?.analyzing() ?? false);
  protected readonly failed = computed(() => this.runSig()?.failed() ?? false);
  /** Прогон шёл правилами без модели: честно показать, что черновик грубее (аудит: silent-rules-fallback). */
  protected readonly byRules = computed(() => this.remark()?.runModel?.startsWith('rules') === true && this.role() !== 'business');
  protected readonly busy = computed(() => this.runSig()?.busy() ?? false);
  protected readonly quoteVisible = computed(() => this.runSig()?.quoteVisible() ?? true);
  protected readonly draftVisible = computed(() => this.runSig()?.draftVisible() ?? true);
  protected readonly phase = computed<Phase | null>(() => {
    const run = this.runSig();
    if (!run || !this.running()) return null;
    return run.rebinding() && run.phase() === 'binding' ? 'rebinding' : run.phase();
  });
  /** Черновик по мере печати моделью — только в колонке «Черновик разбора». */
  protected readonly streamed = computed(() => {
    const text = this.runSig()?.tokens() ?? '';
    return text ? text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  });
  /** Разработчику — первый абзац (что требует ТЗ), остальное по кнопке. */
  protected readonly visibleDraft = computed(() => {
    const draft = this.remark()?.draft ?? [];
    // Пока замечание у PM, разработчик советует — ему нужен весь черновик.
    return this.role() === 'developer' && !this.fullDraft() && this.remark()?.status !== 'awaiting_pm' ? draft.slice(0, 1) : draft;
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
        // «Готово» разработчика: закрыть можно сразу, если проверили сами (ADR 010); кадр — по желанию
        if (r.status === 'ready_for_retest') return 'retest-check';
        if (r.status === 'awaiting_business_close') return 'retest';
        if (r.status === 'awaiting_pm' || r.status === 'triaging') return null;
        return r.verdict || r.status === 'closed' ? 'record' : null;
      case 'developer':
        if (r.status === 'awaiting_pm') return 'dev-advice';
        return r.verdict || r.status === 'ready_for_retest' ? 'record' : null;
      default:
        return null;
    }
  });

  protected readonly canFix = computed(() => this.role() === 'business' || this.role() === 'pm');

  /** Запись решения; разработчику, который советовал, — тихая строка «Совет совпал ✓» / «Ваш совет был: …». */
  /** Заказчик на закрытом замечании: повтор претензии уходит в последний открытый раунд. */
  protected readonly reopenTarget = computed(() => {
    const r = this.remark();
    if (!r || r.status !== 'closed' || this.role() !== 'business' || r.reopenedBy) return null;
    const open = [...this.store.rounds()].reverse().find((x) => x.status === 'open' && x.id !== r.roundId);
    return open ?? null;
  });
  protected readonly reopenLabel = computed(() => (this.reopenTarget() ? CARD.reopenIn(this.reopenTarget()!.number) : null));

  protected async onReopen(): Promise<void> {
    const r = this.remark();
    const target = this.reopenTarget();
    if (!r || !target) return;
    const created = await this.store.reopenRemark(r.id, target.id);
    if (created) await this.router.navigate(links.remark(this.slug(), created.roundNumber, created.number));
  }

  protected readonly recordView = computed<DecisionRecord | null>(() => {
    const base = this.recordBase();
    const r = this.remark()!;
    const my = r.advice?.find((a) => a.userId === this.myUserId());
    if (!base || !my || !r.verdict || this.role() !== 'developer') return base;
    const note = my.code === r.verdict.code ? DECISION.adviceMatched : DECISION.adviceDiffered(VERDICT_LABEL[my.code]);
    return { ...base, sub: [base.sub, note].filter(Boolean).join(' · ') };
  });

  /** Запись решения со штампом. У разработчика после «Готово» — штамп «Готово» поверх вердикта PM. */
  private readonly recordBase = computed<DecisionRecord | null>(() => {
    const r = this.remark()!;
    if (this.role() === 'developer' && r.status === 'ready_for_retest') {
      const v = r.verdict;
      return {
        label: DECISION.readyForRetest,
        who: r.fixedByName ?? '',
        at: '',
        changeable: false,
        stamp: STAMP_LABEL.ready,
        tone: 'work',
        sub: v ? [DECISION.record + ' ' + VERDICT_LABEL[v.code], v.userName, dateTimeRu(v.at)].filter(Boolean).join(' · ') : undefined,
      };
    }
    if (r.status === 'closed') {
      const via = r.closedVia === 'business_check' ? DECISION.closedWithoutFrame : r.closedVia === 'retest' ? DECISION.closedAfterRetest : undefined;
      return { label: DECISION.closedRecord, who: r.closedByName ?? '', at: dateTimeRu(r.closedAt), changeable: false, stamp: STAMP_LABEL.closed, tone: 'ok', comment: r.closeComment, sub: via };
    }
    if (!r.verdict) return null;
    const code = r.verdict.code;
    const label = code === 'rejected_binding' ? statusLabelFor(r.status, this.role()) : VERDICT_LABEL[code];
    return { label, who: r.verdict.userName ?? '', at: dateTimeRu(r.verdict.at), changeable: false, stamp: STAMP_LABEL[code], tone: STAMP_TONE[code], comment: r.verdict.comment };
  });

  protected readonly headerStamp = computed<HeaderStamp | null>(() => (this.remark()!.status === 'closed' ? { label: STAMP_LABEL.closed, tone: 'ok' } : null));

  protected readonly showPill = computed(() => {
    const s = this.remark()!.status;
    return !this.running() && s !== 'awaiting_pm' && s !== 'triaging' && s !== 'closed';
  });

  protected readonly metaLine = computed(() => {
    const r = this.remark()!;
    const round = ROUND.label(r.roundNumber);
    if (r.status === 'ready_for_retest' || r.status === 'awaiting_business_close' || r.status === 'closed') {
      return `${CARD.fixedBy(person(r.fixedByName, r.fixedByRole))} · ${round}`;
    }
    const journal = r.externalId ? ` · ${CARD.fromJournal(r.externalId)}` : '';
    return `${CARD.where} ${r.pageOrScreen} · ${CARD.addedBy(person(r.authorName, r.authorRole))}${journal} · ${round}`;
  });

  /** «Что написал заказчик»: описание (если длиннее заголовка), где, как должно быть, важность. */
  protected readonly saidLines = computed<Array<{ dt: string; dd: string; quote?: boolean }>>(() => {
    const r = this.remark()!;
    if (r.status === 'needs_human_parse') return [];
    const lines: Array<{ dt: string; dd: string; quote?: boolean }> = [];
    const description = r.description?.trim();
    if (description && description !== r.title.trim()) lines.push({ dt: CARD.whatWrong, dd: `«${description}»`, quote: true });
    if (r.pageOrScreen && r.pageOrScreen !== '—' && this.layout() !== 'draft') lines.push({ dt: CARD.where.replace(':', ''), dd: r.pageOrScreen });
    // Повтор претензии: связь с закрытым оригиналом и обратно (docs/STATUS.md closed → reopened)
    if (r.origin) lines.push({ dt: STATUS_LABEL.reopened, dd: CARD.originOf(r.origin.number, r.origin.roundNumber) });
    if (r.reopenedBy) lines.push({ dt: STATUS_LABEL.closed, dd: CARD.reopenedIn(r.reopenedBy.number, r.reopenedBy.roundNumber) });
    if (r.expected) lines.push({ dt: NEW_REMARK.expected, dd: r.expected });
    if (r.severity) lines.push({ dt: CARD.severity.replace(':', ''), dd: r.severity });
    return lines;
  });

  /** Разработчику — что сделать: заметка, где, как должно быть. */
  protected readonly devTodo = computed<string[]>(() => {
    const r = this.remark()!;
    return [r.devNote ?? '', r.pageOrScreen && r.pageOrScreen !== '—' ? `${CARD.where} ${r.pageOrScreen}` : '', r.expected ? `${NEW_REMARK.expected}: ${r.expected}` : ''].filter(Boolean);
  });

  // ---------- кадры ----------

  protected readonly original = computed<Screenshot | null>(() => this.remark()!.screenshots.find((x) => x.kind === 'original') ?? null);
  /** Подсказка дропзоны ретеста: размер первого кадра, если он известен, плюс как прикрепить. */
  protected readonly retestHint = computed(() => {
    const o = this.original();
    return o?.width && o.height ? `${CARD.sameSizeHint(o.width, o.height)} · ${CARD.pasteHint}` : CARD.pasteHint;
  });

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

  /** Кадры сцены ретеста в том же порядке, что frames(): Было · Стало · Дифф. */
  protected readonly stageFrames = computed<StageFrame[]>(() => {
    const shots = this.remark()!.screenshots;
    const kinds: Array<[Screenshot['kind'], string, StageFrame['variant']]> = [
      ['original', CARD.before, 'grey'],
      ['retest', CARD.after, 'blue'],
      ['diff', CARD.diff, 'diff'],
    ];
    const out: StageFrame[] = [];
    for (const [kind, label, fallback] of kinds) {
      const s = shots.find((x) => x.kind === kind);
      if (s) out.push({ kind, label, variant: s.variant ?? fallback, src: s.url ?? null });
    }
    return out;
  });

  protected openViewer(index: number): void {
    this.viewer.set(index);
  }

  // ---------- черновик ----------

  protected readonly specCitation = computed(() => this.remark()!.citations.find((c) => c.source === 'spec') ?? null);
  protected readonly otherCitations = computed(() => this.remark()!.citations.filter((c) => c.source !== 'spec'));
  /** Заказчику черновик приходит только вместе с решением (ADR 007) — до него и цитаты не показываем. */
  protected readonly draftShown = computed(() => this.role() !== 'business' || (this.remark()?.draft.length ?? 0) > 0);
  /** Заказчик смотрит замечание, которое ждёт руководителя приёмки: вместо пустой колонки — объяснение. */
  protected readonly customerWaiting = computed(() => !this.running() && !this.draftShown() && this.remark()?.status === 'awaiting_pm');
  /** Разбор был, а цитаты из ТЗ нет — так и пишем, а не оставляем место пустым (20.09). */
  protected readonly noSpecNote = computed(() => {
    const s = this.remark()!.status;
    return !this.running() && s !== 'imported' && s !== 'reopened' && s !== 'duplicate' && s !== 'triaging';
  });
  protected readonly documentsLink = computed(() => links.documents(this.slug()));

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
    if (this.failed()) return r.runFailure ?? PHASE_TEXT.failed;
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
        return role === 'business' ? PHASE_EXTRA.awaitingCheck : PHASE_EXTRA.awaitingCheckOther;
      case 'awaiting_business_close':
        return role === 'business' ? PHASE_TEXT.awaiting_business_close : PHASE_EXTRA.awaitingBusinessOther;
      case 'closed':
        return PHASE_EXTRA.closedAt(r.closedByName ?? '', dateTimeRu(r.closedAt));
      default:
        return statusLabelFor(r.status, role);
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

  /** Совет разработчика — сразу, без отсчёта: он обратим («Изменить» / «Убрать»). */
  protected onAdvise(e: { code: VerdictCode; comment: string }): void {
    void this.store.advise(this.remarkId(), e.code, e.comment);
  }

  protected onRetractAdvice(): void {
    void this.store.retractAdvice(this.remarkId());
  }

  protected onVerdict(e: { code: Exclude<VerdictCode, 'rejected_binding'>; comment: string }): void {
    const id = this.remarkId();
    this.actions.schedule({ remarkId: id, label: VERDICT_LABEL[e.code], inline: true, commit: () => this.store.verdict(id, e.code, e.comment) });
  }

  protected onClose(comment = ''): void {
    const id = this.remarkId();
    this.actions.schedule({ remarkId: id, label: DECISION.closeFixed, inline: true, commit: () => this.store.close(id, comment) });
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
    await this.upload(action, file);
  }

  /** Файл из дропзоны или Ctrl+V — тем же путём, что и выбор через диалог. */
  protected async onDropped(action: FileAction, file: File): Promise<void> {
    await this.upload(action, file);
  }

  private async upload(action: FileAction, file: File): Promise<void> {
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
  protected onHistoryToggle(e: Event): void {
    this.historyOpen = (e.target as HTMLDetailsElement).open;
    if (this.historyOpen) void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    this.historyLoading.set(true);
    try {
      this.history.set(await this.api.remarkHistory(this.projectId(), this.remarkId()));
    } catch {
      this.history.set([]);
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected person(name: string, role: Role | undefined): string {
    return person(name, role);
  }

  protected actionLabel(e: RemarkHistoryEntry): string {
    // Закрытие сразу после «Готово» — без нового кадра, заказчик проверил сам (ADR 010)
    if (e.action === 'close' && e.fromStatus === 'ready_for_retest') return HISTORY_ACTION['close_checked']!;
    // «Кто кому направил»: решение PM называет вариант — «В работу разработчикам», «Новое желание…»
    if (e.action === 'verdict' && e.toStatus in VERDICT_LABEL) return `${HISTORY_ACTION['verdict']}: ${VERDICT_LABEL[e.toStatus as VerdictCode]}`;
    return HISTORY_ACTION[e.action] ?? e.action;
  }

  /** Дата с годом и время в поясе читателя (ADR 011): через год по истории должно быть видно, какой это был сентябрь. */
  protected when(iso: string): string {
    return dateTimeRu(iso);
  }

  /** Кадр действия из истории — в том же просмотрщике; заменённый кадр по-прежнему открывается (ADR 011). */
  protected openHistoryShot(e: RemarkHistoryEntry): void {
    if (!e.shot) return;
    const variant = e.shot.kind === 'diff' ? 'diff' : e.shot.kind === 'retest' ? 'blue' : 'grey';
    // Подпись вида кадра показывает сам просмотрщик — в заголовке только момент действия
    this.historyShot.set({ title: this.when(e.at), frame: { label: CARD.historyShot[e.shot.kind], variant, src: e.shot.url } });
  }

}

/** «Business (заказчик)»: имя с ролью в проекте — людей на одной стороне может быть несколько. */
function person(name: string | undefined, role: Role | undefined): string {
  if (!name) return '';
  return role ? CARD.withRole(name, ROLE_SHORT[role]) : name;
}
