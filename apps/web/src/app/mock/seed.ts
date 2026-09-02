/**
 * Остаток мок-данных: строки импорта для экрана «Импорт» (парсер — фаза 4).
 * Остальное (пользователи, замечания, документы) теперь приходит из API.
 */
import type { ImportRow } from '../core/models';

export const IMPORT_FILE_NAME = 'Журнал_раунд2.xlsx';

export const IMPORT_ROWS: ImportRow[] = [
  { rowNumber: 1, text: 'Не открывается профиль', status: 'parsed' },
  { rowNumber: 2, text: 'Логотип не по центру', status: 'parsed' },
  { rowNumber: 3, text: 'Сортировка списка заказов', status: 'parsed' },
  { rowNumber: 4, text: '', status: 'needs_human_parse' },
  { rowNumber: 5, text: 'Фильтр клиентов сбрасывается при обновлении', status: 'parsed' },
  { rowNumber: 6, text: 'Пагинация пропадает на второй странице', status: 'parsed' },
  { rowNumber: 7, text: 'Ошибка оплаты тостом', status: 'parsed' },
  { rowNumber: 8, text: '', status: 'needs_human_parse' },
  { rowNumber: 9, text: 'Повтор №4 про поиск', status: 'parsed' },
  { rowNumber: 10, text: 'Хотим тёмную тему', status: 'parsed', remarkNumber: 13 },
  { rowNumber: 11, text: 'Выгрузка в Excel', status: 'parsed', remarkNumber: 14 },
];
