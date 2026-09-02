import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, NEW_REMARK } from '../core/copy';
import { RemarksStore } from '../core/remarks.store';
import { SessionService } from '../core/session.service';
import { GlassHeader } from '../ui/glass-header';
import { Shot } from '../ui/shot';

/** Добавить замечание (бизнес): «Что не так», «Где», «Как должно быть», «Прикрепить скрин», «Сохранить». */
@Component({
  selector: 'rr-new-remark-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, GlassHeader, Shot],
  template: `
    <div class="page">
      <rr-glass-header [presence]="false" />
      <main class="page__body page__body--loose">
        <form class="paper form" (submit)="save($event)" novalidate>
          <h1 class="form__title">{{ copy.title }}</h1>
          <label class="field">
            <span class="field__label">{{ copy.what }}</span>
            <textarea class="textarea" rows="4" [placeholder]="copy.whatPlaceholder" [value]="what()" (input)="what.set(value($event))" [class.input--danger]="showError()"></textarea>
          </label>
          <label class="field">
            <span class="field__label">{{ copy.where }}</span>
            <input class="input" [placeholder]="copy.wherePlaceholder" [value]="where()" (input)="where.set(value($event))" />
          </label>
          <label class="field">
            <span class="field__label">{{ copy.expected }}</span>
            <textarea class="textarea" rows="2" [placeholder]="copy.expectedPlaceholder" [value]="expected()" (input)="expected.set(value($event))"></textarea>
          </label>
          <div class="field">
            <span class="field__label">{{ copy.attach }}</span>
            <span class="meta">{{ needShot }}</span>
            @if (hasShot()) {
              <div class="shot-row">
                <div class="shot-preview"><rr-shot variant="grey" /></div>
                <div class="shot-meta">
                  <span class="meta">{{ copy.shotMeta }}</span>
                  <button type="button" class="btn btn--secondary shot-replace" (click)="hasShot.set(true)">{{ copy.replace }}</button>
                </div>
              </div>
            } @else {
              <button type="button" class="btn btn--secondary shot-attach" (click)="hasShot.set(true)">{{ copy.attach }}</button>
            }
          </div>
          <div class="form__actions">
            <a class="btn btn--secondary" [routerLink]="journalLink()">{{ copy.cancel }}</a>
            <button type="submit" class="btn btn--primary">{{ copy.save }}</button>
          </div>
        </form>
      </main>
    </div>
  `,
  styles: `
    .form {
      width: 640px;
      max-width: 100%;
      margin: 8px auto 0;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .form__title {
      margin: 0;
      font-size: 22px;
      line-height: 28px;
      font-weight: 600;
    }
    .field {
      gap: 8px;
    }
    .shot-row {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .shot-preview {
      width: 200px;
      flex: none;
    }
    .shot-meta {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .shot-replace,
    .shot-attach {
      min-height: 36px;
      padding: 0 14px;
      width: max-content;
    }
    .form__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    @media (max-width: 720px) {
      .form {
        padding: 16px;
      }
    }
  `,
})
export class NewRemarkPage {
  readonly projectId = input.required<string>();
  readonly round = input.required<string>();

  private readonly store = inject(RemarksStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly copy = NEW_REMARK;
  protected readonly needShot = EMPTY.needShot;
  protected readonly what = signal('');
  protected readonly where = signal('');
  protected readonly expected = signal('');
  protected readonly hasShot = signal(false);
  protected readonly touched = signal(false);
  protected readonly showError = computed(() => this.touched() && !this.what().trim());

  protected value(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected journalLink(): unknown[] {
    return ['/p', this.projectId(), 'r', this.round()];
  }

  protected save(e: Event): void {
    e.preventDefault();
    this.touched.set(true);
    if (!this.what().trim()) return;
    const remark = this.store.addRemark(
      { title: this.what(), pageOrScreen: this.where(), expected: this.expected(), withShot: this.hasShot() },
      this.session.user()?.id ?? '',
    );
    void this.router.navigate(['/p', this.projectId(), 'r', this.round(), 'remarks', remark.id]);
  }
}
