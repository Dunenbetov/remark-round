import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { InstanceAdminGuard } from './instance-admin.guard';

@Module({
  imports: [TenancyModule],
  controllers: [AdminController],
  providers: [AdminService, InstanceAdminGuard],
})
export class AdminModule {}
