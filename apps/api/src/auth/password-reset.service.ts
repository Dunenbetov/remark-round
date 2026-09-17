import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { securityEvent } from '../observability/security-log';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken, newToken } from '../tenancy/invitations.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { hashPassword } from './password';

/**
 * Ссылка живёт сутки (ADR 013): писем нет, администратор передаёт её человеку сам — в мессенджере или лично,
 * и человек может открыть её не сразу. Дольше не нужно: токен в чате и в access-логах прокси не должен работать неделю.
 */
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

export const RESET_LINK_DEAD = 'Ссылка для смены пароля не действует — попросите администратора выдать новую';
export const RESET_LINK_USED = 'Ссылка уже использована — попросите администратора выдать новую';
export const RESET_USER_DISABLED = 'Человек отключён — сначала включите его';

/** Ссылка /reset/<token>: сырой токен отдаётся администратору один раз, как у приглашений. */
export interface PasswordResetLink {
  token: string;
  expiresAt: string;
}

/**
 * Смена забытого пароля (ADR 012, изменено ADR 013). Писем нет: ссылку выдаёт администратор инстанса
 * (POST /admin/users/:userId/reset-link) и передаёт человеку сам. Токен — как у приглашений: в БД sha256, наружу один раз;
 * одноразовый (usedAt ставится условно, второй параллельный сброс получает 410); новая ссылка гасит прежние ссылки человека.
 * Сброс = выход везде, как смена пароля: passwordChangedAt и tokenVersion. Сессию с публичного эндпоинта не выдаём —
 * человек входит на /login с новым паролем.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  /** Только администратор инстанса (guard на контроллере). Отключённому ссылку не выдаём: войти он всё равно не сможет. */
  async issueLink(actorUserId: string, userId: string): Promise<PasswordResetLink> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, disabledAt: true } });
    if (!user) throw new NotFoundException();
    if (user.disabledAt) throw new ConflictException(RESET_USER_DISABLED);
    const token = newToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.prisma.$transaction([
      // Действует только последняя ссылка; отработавшие старше суток — в корзину, таблица не растёт
      this.prisma.passwordReset.deleteMany({ where: { userId, OR: [{ usedAt: null }, { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }] } }),
      this.prisma.passwordReset.create({ data: { userId, tokenHash: hashToken(token), expiresAt } }),
    ]);
    securityEvent('password.reset_link', { by: actorUserId, userId });
    return { token, expiresAt: expiresAt.toISOString() };
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
