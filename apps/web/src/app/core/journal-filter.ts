import type { JournalChip } from './copy';
import type { Remark, Role } from './models';

/** Фильтр журнала: чип × роль. «Ждут меня» у бизнеса и у PM — разные статусы. */
export function filterRemarks(list: Remark[], chip: JournalChip, role: Role | null): Remark[] {
  switch (chip) {
    case 'Ждут меня':
      return list.filter((r) =>
        role === 'business'
          ? r.status === 'cannot_tell' || r.status === 'ready_for_retest' || r.status === 'awaiting_business_close' || r.status === 'unspecified'
          : r.status === 'awaiting_pm' || r.status === 'cannot_tell',
      );
    case 'В работе':
      return list.filter((r) => r.status === 'defect');
    case 'Новые желания':
      return list.filter((r) => r.status === 'change_request' || (r.status === 'awaiting_pm' && r.proposedClass === 'change_request_candidate'));
    case 'На ретесте':
      return list.filter((r) => r.status === 'ready_for_retest' || r.status === 'awaiting_business_close');
    case 'Закрыто':
      return list.filter((r) => r.status === 'closed');
    case 'Дописать из журнала':
      return list.filter((r) => r.status === 'needs_human_parse');
    default:
      return list;
  }
}
