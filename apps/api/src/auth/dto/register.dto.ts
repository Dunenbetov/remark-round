import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import type { Role } from '@remarkround/db';

/** Стороны при регистрации: admin — роль проекта, её не выбирают (ADR 005). */
export const SIDES: Role[] = ['business', 'pm', 'developer'];

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsIn(SIDES)
  preferredRole!: Role;

  /** Пришёл по ссылке /join/<token>: приглашение принимается сразу, даже если e-mail другой. */
  @IsOptional()
  @IsString()
  @Length(20, 80)
  inviteToken?: string;
}
