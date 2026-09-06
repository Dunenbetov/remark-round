import { Module } from '@nestjs/common';
import { config } from '../config';
import { JobsModule } from '../jobs/jobs.module';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT, smtpTransport } from './mail.transport';

@Module({
  imports: [JobsModule],
  providers: [
    MailService,
    {
      provide: MAIL_TRANSPORT,
      // Без SMTP_URL транспорта нет: MailService.enabled = false, письма помечаются «пропущено»
      useFactory: () => {
        const url = config().SMTP_URL;
        return url ? smtpTransport(url) : null;
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
