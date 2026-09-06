import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Role } from '@remarkround/db';
import { SIDES } from './register.dto';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(SIDES)
  preferredRole?: Role;

  /** Письма «вас ждёт кнопка» (ADR 009). Приглашения и служебные письма флаг не трогает. */
  @IsOptional()
  @IsBoolean()
  notifyByEmail?: boolean;
}
