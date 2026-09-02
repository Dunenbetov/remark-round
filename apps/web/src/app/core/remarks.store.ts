import { Injectable, computed, signal } from '@angular/core';
import type {
  Citation,
  ImportRow,
  NewRemarkDto,
  ProjectDocument,
  Remark,
  RemarkStatus,
  RetestOutcome,
  VerdictCode,
} from './models';
import {
  CITE_PROTOCOL_12_03,
  CITE_SPEC_2_1,
  CITE_SPEC_4_3,
  DOCUMENTS,
  IMPORT_ROWS,
  PROJECT,
  REMARKS,
  ROUND,
} from '../mock/seed';

export class IllegalTransitionError extends Error {
  constructor(from: RemarkStatus, action: string) {
    super(`Переход «${action}» из статуса ${from} запрещён (docs/STATUS.md)`);
  }
}

/**
 * Мок-хранилище замечаний. Переходы статусов — строго по docs/STATUS.md:
 * нет авто-закрытия, `closed` ставит только бизнес.
 * В фазе 1+ методы становятся вызовами REST из docs/API.md.
 */
@Injectable({ providedIn: 'root' })
export class RemarksStore {
  readonly project = PROJECT;
  readonly round = ROUND;

  private readonly _remarks = signal<Remark[]>(structuredClone(REMARKS));
  private readonly _documents = signal<ProjectDocument[]>(structuredClone(DOCUMENTS));
  private readonly _importRows = signal<ImportRow[]>(structuredClone(IMPORT_ROWS));

  readonly remarks = this._remarks.asReadonly();
  readonly documents = this._documents.asReadonly();
  readonly importRows = this._importRows.asReadonly();

  readonly total = computed(() => this._remarks().length);
  /** «Ждут вас» у PM: ждут решения или скрина (как в журнале дизайна: 12, 13, 14, 15). */
  readonly awaitingCount = computed(
    () => this._remarks().filter((r) => r.status === 'awaiting_pm' || r.status === 'cannot_tell').length,
  );
  /** Разработчик видит только принятые поломки и то, что сам отдал на ретест. */
  readonly devQueue = computed(() =>
    this._remarks().filter((r) => r.status === 'defect' || r.status === 'ready_for_retest'),
  );
  readonly hasSpec = computed(() => this._documents().some((d) => d.kind === 'spec'));

  isMember(projectId: string, userId: string): boolean {
    return projectId === PROJECT.id && PROJECT.memberIds.includes(userId);
  }

  byId(id: string): Remark | undefined {
    return this._remarks().find((r) => r.id === id);
  }

  // ---------- решения PM ----------

  verdict(remarkId: string, code: Exclude<VerdictCode, 'rejected_binding'>, userId: string, comment?: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'awaiting_pm' && r.status !== 'unspecified') throw new IllegalTransitionError(r.status, code);
      if (r.status === 'unspecified' && code !== 'defect' && code !== 'change_request') {
        throw new IllegalTransitionError(r.status, code);
      }
      return { ...r, status: code, verdict: { code, userId, at: now(), comment: comment || undefined } };
    });
  }

  /** «Не та цитата из ТЗ»: тот же прогон, статус остаётся awaiting_pm, цитата меняется. */
  rejectBinding(remarkId: string, userId: string, comment: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'awaiting_pm') throw new IllegalTransitionError(r.status, 'rejected_binding');
      const current = r.citations.find((c) => c.source === 'spec');
      const next: Citation = current?.id === CITE_SPEC_4_3.id ? CITE_SPEC_2_1 : CITE_SPEC_4_3;
      const citations = [next, ...r.citations.filter((c) => c.source !== 'spec')];
      return { ...r, citations, verdict: { code: 'rejected_binding', userId, at: now(), comment } };
    });
  }

  /** «Изменить решение» — возвращаем на стол PM. */
  reopenDecision(remarkId: string): void {
    this.update(remarkId, (r) => {
      if (!['defect', 'change_request', 'unspecified', 'duplicate', 'cannot_tell'].includes(r.status)) {
        throw new IllegalTransitionError(r.status, 'reopen_decision');
      }
      return { ...r, status: 'awaiting_pm', verdict: undefined };
    });
  }

  linkDuplicate(remarkId: string): void {
    this.update(remarkId, (r) => ({ ...r, duplicateLinked: true }));
  }

  // ---------- разработчик ----------

  readyForRetest(remarkId: string, userId: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'defect') throw new IllegalTransitionError(r.status, 'ready_for_retest');
      return { ...r, status: 'ready_for_retest', fixedByUserId: userId };
    });
  }

  // ---------- бизнес ----------

  /** Новый кадр по «Не хватает скрина» → снова разбираем. */
  attachShot(remarkId: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'cannot_tell') throw new IllegalTransitionError(r.status, 'attach_shot');
      return {
        ...r,
        status: 'triaging',
        screenshots: [{ kind: 'original', variant: 'grey', fileName: 'futer.png' }],
        citations: [CITE_SPEC_2_1, CITE_PROTOCOL_12_03],
        seen: 'ссылки в футере серые на фоне того же тона.',
        draft: ['Похоже, это поломка относительно ТЗ.', 'ТЗ требует контрастные ссылки; на кадре ссылки футера сливаются с фоном. Похожих замечаний в раунде нет.'],
        draftShort: 'Похоже, это поломка относительно ТЗ',
        proposedClass: 'defect_candidate',
      };
    });
  }

  /** Результат сравнения кадров: новый кадр + дифф, ждём закрытия бизнесом. */
  completeRetest(remarkId: string, outcome: RetestOutcome, explanation: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'ready_for_retest') throw new IllegalTransitionError(r.status, 'retest');
      const original = r.screenshots.find((s) => s.kind === 'original');
      const screenshots = original
        ? [original, { kind: 'retest' as const, variant: 'blue' as const, fileName: 'novyi-kadr.png' }, { kind: 'diff' as const, variant: 'diff' as const }]
        : r.screenshots;
      return { ...r, status: 'awaiting_business_close', screenshots, retest: { outcome, explanation } };
    });
  }

  close(remarkId: string, userId: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'awaiting_business_close') throw new IllegalTransitionError(r.status, 'close');
      return { ...r, status: 'closed', closedByUserId: userId, closedAt: now() };
    });
  }

  notFixed(remarkId: string): void {
    this.update(remarkId, (r) => {
      if (r.status !== 'awaiting_business_close') throw new IllegalTransitionError(r.status, 'not_fixed');
      return { ...r, status: 'defect', retest: undefined, screenshots: r.screenshots.filter((s) => s.kind === 'original') };
    });
  }

  addRemark(dto: NewRemarkDto, authorId: string): Remark {
    const number = Math.max(0, ...this._remarks().map((r) => r.number)) + 1;
    const remark: Remark = {
      id: `rm-${number}`,
      projectId: PROJECT.id,
      roundNumber: ROUND.number,
      number,
      title: dto.title.trim(),
      pageOrScreen: dto.pageOrScreen.trim() || '—',
      description: dto.title.trim(),
      expected: dto.expected?.trim() || undefined,
      status: 'triaging',
      authorId,
      screenshots: dto.withShot ? [{ kind: 'original', variant: 'grey', fileName: 'profil-kompanii.png' }] : [],
      citations: dto.withShot
        ? [CITE_SPEC_2_1, CITE_PROTOCOL_12_03]
        : [{ id: `c-none-${number}`, source: 'spec', heading: 'В ТЗ:', text: 'Прямой нормы про это ни в ТЗ, ни в протоколе нет.', soft: true }],
      seen: dto.withShot ? 'кнопка «Сохранить» серая, поля заполнены.' : undefined,
      draft: dto.withShot
        ? ['Похоже, это поломка относительно ТЗ.', 'ТЗ требует синюю primary-кнопку; на кадре при заполненных полях она серая. Похожих замечаний в раунде нет.']
        : ['В бумагах нет опоры.', `Заказчик просит: «${dto.title.trim()}». В ТЗ и протоколе про это ничего нет. Решите вы: работа это или новое желание.`],
      draftShort: dto.withShot ? 'Похоже, это поломка относительно ТЗ' : 'В бумагах нет опоры',
      proposedClass: dto.withShot ? 'defect_candidate' : 'unspecified',
    };
    this._remarks.update((list) => [remark, ...list]);
    return remark;
  }

  /** Прогон закончился: черновик записан, ждём решения PM. */
  finishTriage(remarkId: string): void {
    this.update(remarkId, (r) => (r.status === 'triaging' ? { ...r, status: 'awaiting_pm' } : r));
  }

  // ---------- импорт и документы ----------

  saveImportRows(texts: Record<number, string>): number {
    let created = 0;
    const rows = this._importRows().map((row) => {
      const text = texts[row.rowNumber]?.trim();
      if (row.status !== 'needs_human_parse' || !text) return row;
      const remark = this.addRemark({ title: text, pageOrScreen: '', withShot: false }, 'u-aigerim');
      created += 1;
      return { ...row, text, status: 'parsed' as const, remarkNumber: remark.number };
    });
    this._importRows.set(rows);
    return created;
  }

  addDocument(): ProjectDocument {
    const doc: ProjectDocument = {
      id: `d-${Date.now()}`,
      kind: 'addendum',
      label: 'Доп. соглашение',
      fileName: 'Доп_соглашение_3.pdf',
      date: today(),
      pages: 4,
      status: 'parsed',
    };
    this._documents.update((list) => [...list, doc]);
    setTimeout(() => {
      this._documents.update((list) => list.map((d) => (d.id === doc.id ? { ...d, status: 'indexed' } : d)));
    }, 2000);
    return doc;
  }

  private update(remarkId: string, fn: (r: Remark) => Remark): void {
    const current = this.byId(remarkId);
    if (!current) throw new Error(`Замечание ${remarkId} не найдено`);
    const next = fn(current);
    this._remarks.update((list) => list.map((r) => (r.id === remarkId ? next : r)));
  }
}

function now(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
