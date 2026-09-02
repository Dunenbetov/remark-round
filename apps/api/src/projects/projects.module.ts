import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ProjectController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [TenancyModule],
  controllers: [ProjectsController, ProjectController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
