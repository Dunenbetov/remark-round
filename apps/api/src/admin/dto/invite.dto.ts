import { IsEmail } from 'class-validator';

/** Приглашение руководителя приёмки без проекта (ADR 006, 17.09): роль всегда pm, право — canCreateProjects. */
export class AdminInviteDto {
  @IsEmail()
  email!: string;
}
