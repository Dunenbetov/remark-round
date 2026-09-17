import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { InstanceAdminGuard } from './instance-admin.guard';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [AdminController],
  providers: [AdminService, InstanceAdminGuard],
})
export class AdminModule {}
