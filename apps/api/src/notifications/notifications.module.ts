import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [JobsModule, MailModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
