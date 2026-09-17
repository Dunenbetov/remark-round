import { IsBoolean, IsOptional } from 'class-validator';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsBoolean()
  canCreateProjects?: boolean;

  /** true — отключить (токены и сокеты недействительны сразу), false — включить обратно. */
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
