import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RoundsController } from './rounds.controller';

@Module({
  imports: [TenancyModule],
  controllers: [RoundsController],
})
export class RoundsModule {}
