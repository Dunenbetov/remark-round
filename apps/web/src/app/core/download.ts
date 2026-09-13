/**
 * Скачать файл, который API отдаёт только с Bearer (xlsx-журнал): не ссылка, а blob → object URL → клик.
 * Имя файла — наше, те же имена, что в Content-Disposition сервера.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** remarkround-klientskiy-kabinet-journal.xlsx / …-round-2.xlsx */
export function journalFileName(slug: string, roundNumber?: number): string {
  return roundNumber ? `remarkround-${slug}-round-${roundNumber}.xlsx` : `remarkround-${slug}-journal.xlsx`;
}
