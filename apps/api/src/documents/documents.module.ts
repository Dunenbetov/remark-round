import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { RagModule } from '../rag/rag.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [TenancyModule, StorageModule, RagModule, JobsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
