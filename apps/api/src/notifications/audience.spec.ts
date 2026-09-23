/**
 * audience.spec — кому и что сообщает строка истории (ADR 016): таблица правил целиком. Правило ищется по action:
 * `retest` и `cancel` тоже заканчиваются в ready_for_retest, но заказчику «можно смотреть снова» говорит только «Готово».
 */
import type { RemarkStatus } from '@remarkround/db';
import { NOTIFY_ACTIONS, audience, groupOf, kindFor, rolesFor } from './audience';

describe('notifications: правила адресатов', () => {
  const cases: Array<[string, RemarkStatus | null, RemarkStatus, ReturnType<typeof audience>]> = [
    ['proposal', 'triaging', 'awaiting_pm', { pm: 'action' }],
    ['verdict', 'awaiting_pm', 'defect', { developer: 'action', business: 'info' }],
    ['verdict', 'unspecified', 'defect', { developer: 'action', business: 'info' }],
    ['verdict', 'awaiting_pm', 'change_request', { business: 'info' }],
    ['verdict', 'unspecified', 'change_request', { business: 'info' }],
    ['verdict', 'awaiting_pm', 'duplicate', { business: 'info' }],
    ['verdict', 'awaiting_pm', 'unspecified', { business: 'action' }],
    ['verdict', 'awaiting_pm', 'cannot_tell', { business: 'action' }],
    ['ready_for_retest', 'defect', 'ready_for_retest', { business: 'action' }],
    ['retest_result', 'ready_for_retest', 'awaiting_business_close', { business: 'action' }],
    ['not_fixed', 'awaiting_business_close', 'defect', { developer: 'action', business: 'info' }],
    ['close', 'ready_for_retest', 'closed', { business: 'info' }],
    ['close', 'awaiting_business_close', 'closed', { business: 'info' }],
  ];

  it.each(cases)('%s: %s → %s', (action, from, to, expected) => {
    expect(audience(action, from, to)).toEqual(expected);
  });

  it('внутренние шаги и действия без смены очереди — никому', () => {
    const silent: Array<[string, RemarkStatus | null, RemarkStatus]> = [
      ['create', null, 'imported'],
      ['import', null, 'needs_human_parse'],
      ['reopen', null, 'reopened'],
      ['reopened_as', 'closed', 'closed'],
      ['fix_row', 'needs_human_parse', 'imported'],
      ['attach_screenshot', 'cannot_tell', 'cannot_tell'],
      ['triage', 'imported', 'triaging'],
      ['rejected_binding', 'awaiting_pm', 'triaging'],
      ['link_duplicate', 'awaiting_pm', 'awaiting_pm'],
      ['run_failed', 'triaging', 'imported'],
      ['cancel', 'awaiting_pm', 'imported'],
    ];
    for (const [action, from, to] of silent) expect({ action, a: audience(action, from, to) }).toEqual({ action, a: {} });
  });

  it('регресс: retest и cancel заканчиваются в ready_for_retest — без уведомления', () => {
    expect(audience('retest', 'ready_for_retest', 'ready_for_retest')).toEqual({});
    expect(audience('cancel', 'awaiting_business_close', 'ready_for_retest')).toEqual({});
    expect(audience('cancel', 'ready_for_retest', 'ready_for_retest')).toEqual({});
  });

  it('нелегальная пара статусов при известном action — никому (правило не угадывает)', () => {
    expect(audience('verdict', 'awaiting_pm', 'closed')).toEqual({});
    expect(audience('verdict', 'cannot_tell', 'defect')).toEqual({});
    expect(audience('close', 'ready_for_retest', 'defect')).toEqual({});
  });

  it('сторона pm — это pm и legacy admin; вид строки — по роли адресата, по умолчанию «к сведению»', () => {
    expect(groupOf('admin')).toBe('pm');
    expect(rolesFor({ pm: 'action' }).sort()).toEqual(['admin', 'pm']);
    expect(rolesFor({ developer: 'action', business: 'info' }).sort()).toEqual(['business', 'developer']);
    const proposal = { action: 'proposal', fromStatus: 'triaging' as RemarkStatus, toStatus: 'awaiting_pm' as RemarkStatus };
    expect(kindFor(proposal, 'admin')).toBe('action');
    expect(kindFor(proposal, 'business')).toBe('info');
  });

  it('список действий с правилами — ровно те, о которых говорит колокольчик', () => {
    expect([...NOTIFY_ACTIONS].sort()).toEqual(['close', 'not_fixed', 'proposal', 'ready_for_retest', 'retest_result', 'verdict']);
  });
});
