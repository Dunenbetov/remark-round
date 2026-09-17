import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InvitationsController } from './invitations.controller';
import { MembersService } from './members.service';
import { ProjectController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [ProjectsController, ProjectController, InvitationsController],
  providers: [ProjectsService, MembersService],
})
export class ProjectsModule {}
