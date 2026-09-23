import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { NOTIFY_PAGE_MAX } from './notifications.service';

/** GET /auth/notifications?limit=30&before=<id> — страница от новых к старым. */
export class ListNotificationsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFY_PAGE_MAX)
  limit?: number;

  /** id последней строки предыдущей страницы. */
  @IsOptional()
  @IsUUID()
  before?: string;
}

/** POST /auth/notifications/read — ровно одно из трёх: `ids`, `remarkId` или `all: true` (иначе 422, см. контроллер). */
export class ReadNotificationsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids?: string[];

  @IsOptional()
  @IsUUID()
  remarkId?: string;

  @IsOptional()
  @Equals(true)
  all?: true;
}
