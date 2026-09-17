import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@remarkround/db';

/**
 * Интерактивные транзакции (`$transaction(async tx => …)`) по умолчанию ждут соединение 2 с и живут 5 с — при занятом
 * пуле короткая транзакция карточки получала бы P2024 (аудит беты R-B3/R-H1). Здесь общий запас: ждать соединение
 * до 10 с, жить до 30 с; долгие операции (индексация ТЗ) задают свой timeout на месте.
 */
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ transactionOptions: TRANSACTION_OPTIONS });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
