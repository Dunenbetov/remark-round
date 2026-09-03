import { Module } from '@nestjs/common';
import { DiffService } from './diff.service';

/** Детерминированный дифф кадров (ADR 002). Без LLM и без Prisma: чистая функция над двумя буферами. */
@Module({
  providers: [DiffService],
  exports: [DiffService],
})
export class DiffModule {}
