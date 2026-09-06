import type { MailMessage, MailTransport } from '../src/mail/mail.transport';

/** Почта в тестах: письма копятся в памяти; `failNext` подсовывает ошибку SMTP на следующую отправку. */
export class FakeMailTransport implements MailTransport {
  readonly sent: Array<MailMessage & { from: string }> = [];
  readonly failNext: Error[] = [];

  async send(message: MailMessage, from: string): Promise<void> {
    const err = this.failNext.shift();
    if (err) throw err;
    this.sent.push({ ...message, from });
  }

  /** Дождаться N писем (обработчик очереди шлёт их в фоне). */
  async waitFor(count: number, timeoutMs = 10_000): Promise<Array<MailMessage & { from: string }>> {
    const started = Date.now();
    while (this.sent.length < count && Date.now() - started < timeoutMs) await new Promise((r) => setTimeout(r, 50));
    if (this.sent.length < count) throw new Error(`mail: ждали ${count} писем, пришло ${this.sent.length}`);
    return this.sent;
  }
}
