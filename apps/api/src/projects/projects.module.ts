import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ProjectController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [ProjectsController, ProjectController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
