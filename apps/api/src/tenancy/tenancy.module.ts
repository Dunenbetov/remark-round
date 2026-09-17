import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { MembershipGuard } from './membership.guard';
import { RolesGuard } from './roles';
import { TenancyService } from './tenancy.service';

@Module({
  providers: [TenancyService, InvitationsService, MembershipGuard, RolesGuard],
  exports: [TenancyService, InvitationsService, MembershipGuard, RolesGuard],
})
export class TenancyModule {}
