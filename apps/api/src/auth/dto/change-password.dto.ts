import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  current!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  next!: string;
}
