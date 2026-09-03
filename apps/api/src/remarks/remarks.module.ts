import { Module } from '@nestjs/common';
import { DiffModule } from '../diff/diff.module';
import { RagModule } from '../rag/rag.module';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RemarksController } from './remarks.controller';
import { RemarksService } from './remarks.service';
import { TriageStubService } from './triage-stub.service';

@Module({
  imports: [TenancyModule, RagModule, StorageModule, DiffModule],
  controllers: [RemarksController],
  providers: [RemarksService, TriageStubService],
  exports: [RemarksService],
})
export class RemarksModule {}
