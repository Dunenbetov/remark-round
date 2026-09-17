import { createTransport } from 'nodemailer';

/** Письмо как его видит остальной код: адресат, тема, текст и необязательный HTML. Адрес отправителя — из конфига. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Точка подмены в тестах (FakeMailTransport) и единственное место, где живёт nodemailer. */
export interface MailTransport {
  send(message: MailMessage, from: string): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** SMTP по URL вида smtp://user:pass@host:587 или smtps://…:465 (nodemailer сам разбирает схему и TLS). */
export function smtpTransport(url: string): MailTransport {
  const transporter = createTransport(url);
  return {
    async send(message, from) {
      await transporter.sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}
