import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { OffsiteService } from './offsite.service';

/** Суточная копия файлов хранилища в Backblaze B2 (A3, R-M3); без OFFSITE_B2_* модуль ничего не делает. */
@Module({
  imports: [JobsModule, StorageModule],
  providers: [OffsiteService],
  exports: [OffsiteService],
})
export class OffsiteModule {}
