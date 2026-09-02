import { Module } from '@nestjs/common';
import { MembershipGuard } from './membership.guard';
import { RolesGuard } from './roles';

@Module({
  providers: [MembershipGuard, RolesGuard],
  exports: [MembershipGuard, RolesGuard],
})
export class TenancyModule {}
