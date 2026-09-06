import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthView {
  ok: boolean;
  db: 'ok' | 'down';
}

const DB_TIMEOUT_MS = 2000;

/** Health для compose и балансировщика: живой процесс без базы — 503, а не «ok». */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health(): Promise<HealthView> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), DB_TIMEOUT_MS).unref()),
      ]);
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' } satisfies HealthView);
    }
    return { ok: true, db: 'ok' };
  }
}
