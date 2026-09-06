import ExcelJS from 'exceljs';
import type { RemarkView } from '../remarks/remark.dto';
import { STATUS_LABEL_RU, VERDICT_LABEL_RU } from '../remarks/labels';

export const ROUND_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Итог раунда для акта (аудит: no-round-export-close). Собирается из RemarkView, то есть уже с фильтром аудитории:
 * заказчик получает файл без комментариев PM и советов — ровно то, что видит на экране. Кадры — ссылками на API.
 */
export async function buildRoundXlsx(input: { projectName: string; roundNumber: number; publicOrigin: string; remarks: RemarkView[] }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RemarkRound';
  const sheet = workbook.addWorksheet(`Раунд ${input.roundNumber}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '№', key: 'number', width: 6 },
    { header: '№ у заказчика', key: 'externalId', width: 14 },
    { header: 'Где', key: 'where', width: 22 },
    { header: 'Что не так', key: 'description', width: 48 },
    { header: 'Как должно быть', key: 'expected', width: 32 },
    { header: 'Статус', key: 'status', width: 22 },
    { header: 'Решение', key: 'verdict', width: 30 },
    { header: 'Кто решил', key: 'who', width: 18 },
    { header: 'Комментарий к решению', key: 'comment', width: 32 },
    { header: 'Опора в документах', key: 'citation', width: 60 },
    { header: 'Итог ретеста', key: 'retest', width: 32 },
    { header: 'Исправил', key: 'fixedBy', width: 16 },
    { header: 'Закрыл', key: 'closedBy', width: 16 },
    { header: 'Кадры', key: 'shots', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const r of [...input.remarks].sort((a, b) => a.number - b.number)) {
    sheet.addRow({
      number: r.number,
      externalId: r.externalId ?? '',
      where: r.pageOrScreen === '—' ? '' : r.pageOrScreen,
      description: r.description,
      expected: r.expected ?? '',
      status: STATUS_LABEL_RU[r.status],
      verdict: r.verdict ? VERDICT_LABEL_RU[r.verdict.code] : '',
      who: r.verdict ? [r.verdict.userName, r.verdict.at].filter(Boolean).join(' · ') : '',
      comment: r.verdict?.comment ?? '',
      citation: r.citations.map((c) => `${c.heading} ${c.text}`).join('\n'),
      retest: r.retest ? [retestLabel(r.retest.outcome), r.retest.explanation].filter(Boolean).join(' — ') : '',
      fixedBy: r.fixedByName ?? '',
      closedBy: r.closedByName ? [r.closedByName, r.closedAt].filter(Boolean).join(' · ') : '',
      shots: r.screenshots.map((s) => `${shotLabel(s.kind)}: ${input.publicOrigin}${s.url}`).join('\n'),
    });
  }
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

function retestLabel(outcome: 'likely_addressed' | 'likely_unchanged' | 'cannot_tell'): string {
  return outcome === 'likely_addressed' ? 'Похоже, исправлено' : outcome === 'likely_unchanged' ? 'Похоже, без изменений' : 'По кадрам не понять';
}

function shotLabel(kind: 'original' | 'retest' | 'diff'): string {
  return kind === 'original' ? 'было' : kind === 'retest' ? 'стало' : 'дифф';
}
