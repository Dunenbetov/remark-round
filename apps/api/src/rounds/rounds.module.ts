import { Module } from '@nestjs/common';
import { RemarksModule } from '../remarks/remarks.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RoundsController } from './rounds.controller';
import { RoundsService } from './rounds.service';

@Module({
  imports: [TenancyModule, RemarksModule],
  controllers: [RoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
