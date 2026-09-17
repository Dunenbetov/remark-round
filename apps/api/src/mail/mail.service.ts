import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { config } from '../config';
import { JobsService, RetryJobError, type JobContext } from '../jobs/jobs.service';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from './mail.transport';

/**
 * Почта (ADR 009). Без SMTP_URL писем нет — `enabled = false`, и всё, что хотело написать, честно помечается
 * «пропущено», а не падает. Отправка идёт задачей очереди `send_mail`: SMTP-провайдер, который не отвечает
 * минуту, не роняет запрос PM и не теряет письмо — три попытки с паузой, как у модели.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly log = new Logger(MailService.name);
  readonly enabled: boolean;
  private readonly from: string;

  constructor(
    private readonly jobs: JobsService,
    @Optional() @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
  ) {
    const cfg = config();
    this.enabled = Boolean(this.transport) && Boolean(cfg.SMTP_URL);
    this.from = cfg.SMTP_FROM;
  }

  onModuleInit(): void {
    // Письма несут сырые ссылки /join и /reset: после отправки строка задачи удаляется (I-1)
    this.jobs.register('send_mail', (payload, ctx) => this.deliver(payload as MailMessage, ctx), { sensitive: true });
    if (!this.enabled && config().isProduction) this.log.warn('SMTP_URL не задан: письма (приглашения, «вас ждёт кнопка») не отправляются');
  }

  /** Поставить письмо в очередь. Возвращает false, если почта выключена — вызывающий скажет об этом человеку. */
  async enqueue(message: MailMessage, projectId?: string): Promise<boolean> {
    if (!this.enabled) return false;
    await this.jobs.enqueue('send_mail', message, { projectId });
    return true;
  }

  /** Отправить прямо сейчас (из обработчика другой задачи): ошибка транспорта уходит наверх, решать повтор — вызывающему. */
  async send(message: MailMessage): Promise<void> {
    if (!this.transport) throw new Error('SMTP не настроен');
    await this.transport.send(message, this.from);
  }

  private async deliver(message: MailMessage, ctx: JobContext): Promise<void> {
    try {
      await this.send(message);
    } catch (e) {
      const err = e as Error;
      if (ctx.attempt < ctx.maxAttempts) throw new RetryJobError(`smtp: ${err.message}`);
      throw err;
    }
  }
}
