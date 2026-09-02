import { IsEmail, IsIn } from 'class-validator';
import type { Role } from '@remarkround/db';

const ROLES: Role[] = ['business', 'pm', 'developer', 'admin'];

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(ROLES)
  role!: Role;
}
