import { Module } from '@nestjs/common';
import { RemarksModule } from '../remarks/remarks.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ImportsController } from './imports.controller';
import { ImportService } from './imports.service';

@Module({
  imports: [TenancyModule, StorageModule, RemarksModule],
  controllers: [ImportsController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportsModule {}
