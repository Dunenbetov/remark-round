import { Module } from '@nestjs/common';
import { MembershipGuard } from './membership.guard';
import { RolesGuard } from './roles';
import { TenancyService } from './tenancy.service';

@Module({
  providers: [TenancyService, MembershipGuard, RolesGuard],
  exports: [TenancyService, MembershipGuard, RolesGuard],
})
export class TenancyModule {}
