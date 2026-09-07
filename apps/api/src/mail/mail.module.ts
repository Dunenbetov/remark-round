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
      // Без SMTP_URL транспорта нет: MailService.enabled = false, письма помечаются «пропущено».
      // В тестах настоящий SMTP не поднимается никогда: стенд (test/harness.ts) подменяет транспорт на FakeMailTransport
      useFactory: () => {
        const cfg = config();
        return cfg.SMTP_URL && cfg.NODE_ENV !== 'test' ? smtpTransport(cfg.SMTP_URL) : null;
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
