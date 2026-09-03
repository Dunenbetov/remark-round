import type { ImportRowStatus, RemarkStatus } from '@remarkround/db';
import { IsUUID } from 'class-validator';
import type { JournalCells } from './journal-parser';

/** multipart: поле `file` + `roundId`. */
export class CreateImportDto {
  @IsUUID()
  roundId!: string;
}

export interface ImportRowView {
  rowNumber: number;
  status: ImportRowStatus;
  externalId: string | null;
  /** Первая строка description — что показывать в списке. */
  text: string;
  pageOrScreen: string | null;
  /** Почему строка ушла человеку (по-русски). */
  reason: string | null;
  /** Ссылка в файле, которую мы не тянем: скрин прикрепляют на карточке. */
  screenshotRef: string | null;
  hasScreenshot: boolean;
  remarkId: string | null;
  remarkNumber: number | null;
  remarkStatus: RemarkStatus | null;
  cells: JournalCells;
}

export interface ImportJobView {
  id: string;
  projectId: string;
  roundId: string;
  fileName: string;
  createdAt: string;
  rows: ImportRowView[];
  parsed: number;
  needsHumanParse: number;
}
