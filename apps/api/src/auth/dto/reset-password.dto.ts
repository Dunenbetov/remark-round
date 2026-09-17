import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  /** Токен из ссылки /reset/<token> — тот же формат, что у приглашений. */
  @IsString()
  @Length(20, 80)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
