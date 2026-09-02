import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MediaController } from './media.controller';

@Module({
  imports: [StorageModule, TenancyModule],
  controllers: [MediaController],
})
export class MediaModule {}
