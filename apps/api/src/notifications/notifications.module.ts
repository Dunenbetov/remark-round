import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UserEvents } from './user-events';

/**
 * NotificationsModule (ADR 016): колокольчик о замечаниях. Доменных модулей не импортирует — RemarksService зовёт
 * `record()` в своей транзакции, гейтвей слушает `UserEvents`; циклов нет.
 */
@Module({
  imports: [JobsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, UserEvents],
  exports: [NotificationsService, UserEvents],
})
export class NotificationsModule {}
