import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { config } from '../config';
import { MailService } from '../mail/mail.service';
import { passwordResetMail } from '../mail/templates';
import { securityEvent } from '../observability/security-log';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, newToken, normalizeEmail } from '../tenancy/invitations.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { hashPassword } from './password';

/** Ссылка живёт час: письмо читают сразу, а токен в почте и в access-логах прокси не должен работать неделю. */
export const RESET_TTL_MS = 60 * 60 * 1000;
/** Повтор раньше минуты — без второго письма: 120 запросов в минуту с IP не должны превращаться в флуд чужого ящика. */
export const RESET_COOLDOWN_MS = 60 * 1000;

export const RESET_LINK_DEAD = 'Ссылка для смены пароля не действует — запросите новую';
export const RESET_LINK_USED = 'Ссылка уже использована — запросите новую';

/**
 * «Забыли пароль» (ADR 012, ревью беты I-5). /auth/forgot всегда отвечает 204: существование адреса не раскрывается,
 * поиск делается в любом случае. Токен — как у приглашений: в БД sha256, наружу один раз в письме; одноразовый
 * (usedAt ставится условно, второй параллельный сброс получает 410); новый запрос гасит прежние ссылки человека.
 * Сброс = выход везде, как смена пароля: passwordChangedAt и tokenVersion. Сессию с публичного эндпоинта не выдаём —
 * человек входит на /login с новым паролем.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tenancy: TenancyService,
  ) {}

  async forgot(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    securityEvent('password.forgot', { email: normalized, known: Boolean(user) });
    // Без пароля (вход через провайдера), отключённый, почта выключена — молча: ответ тот же 204
    if (!user || !user.passwordHash || user.disabledAt || !this.mail.enabled) return;
    const recent = await this.prisma.passwordReset.findFirst({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } } });
    if (recent) return;
    const token = newToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.prisma.$transaction([
      // Действует только последняя ссылка; отработавшие старше суток — в корзину, таблица не растёт
      this.prisma.passwordReset.deleteMany({ where: { userId: user.id, OR: [{ usedAt: null }, { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }] } }),
      this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } }),
    ]);
    await this.mail.enqueue(passwordResetMail({ to: user.email, name: user.name, url: `${config().WEB_ORIGIN}/reset/${token}`, expiresAt }));
  }

  async reset(token: string, password: string): Promise<void> {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.expiresAt < new Date()) throw new NotFoundException(RESET_LINK_DEAD);
    if (row.usedAt) throw new GoneException(RESET_LINK_USED);
    // scrypt ~100 мс — до транзакции, чтобы не держать соединение из пула
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (count !== 1) throw new GoneException(RESET_LINK_USED);
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
    });
    this.tenancy.revoke(row.userId);
    securityEvent('password.reset', { userId: row.userId });
  }
}
