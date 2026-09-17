import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import type { DocumentKind } from '@remarkround/db';

const KINDS: DocumentKind[] = ['spec', 'protocol', 'addendum', 'journal_source'];

export class UploadDocumentDto {
  @IsIn(KINDS)
  kind!: DocumentKind;

  /** Дата документа (протокол от 12.03): для выбора актуальной версии в фазе 6. */
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}
