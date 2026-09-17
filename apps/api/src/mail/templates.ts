import type { NotificationKind, Role } from '@remarkround/db';
import type { MailMessage } from './mail.transport';

/** Подписи ролей в письмах — те же слова, что на экране (docs/ui/COPY.md). */
const ROLE_LABEL: Record<Role, string> = { business: 'заказчик', pm: 'руководитель приёмки', developer: 'разработчик', admin: 'руководитель приёмки' };

/** Что именно ждёт человека — по статусу замечания (docs/STATUS.md «Кто имеет право»). */
export const KIND_LABEL: Record<NotificationKind, string> = {
  awaiting_pm: 'ждёт вашего решения',
  defect: 'принят как дефект — в работу',
  ready_for_retest: 'исправлено — проверьте: закройте или приложите новый кадр',
  awaiting_business_close: 'ретест готов — закройте или верните',
  cannot_tell: 'не хватает скрина — добавьте',
};

export interface DigestItem {
  projectName: string;
  roundNumber: number;
  number: number;
  description: string;
  kind: NotificationKind;
  url: string;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const short = (s: string, max = 90): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Одно письмо на всё, что накопилось у человека: по проектам, внутри — по замечаниям. */
export function digestMail(to: string, name: string, items: DigestItem[], settingsUrl: string): MailMessage {
  const byProject = new Map<string, DigestItem[]>();
  for (const it of items) byProject.set(it.projectName, [...(byProject.get(it.projectName) ?? []), it]);
  const subject = items.length === 1 ? `RemarkRound: замечание №${items[0]!.number} ${KIND_LABEL[items[0]!.kind]}` : `RemarkRound: вас ждут ${items.length} ${plural(items.length, 'замечание', 'замечания', 'замечаний')}`;
  const textParts: string[] = [`${name}, здравствуйте.`, ''];
  const htmlParts: string[] = [`<p>${esc(name)}, здравствуйте.</p>`];
  for (const [project, list] of byProject) {
    textParts.push(`Проект «${project}»:`);
    htmlParts.push(`<p><b>Проект «${esc(project)}»</b></p><ul>`);
    for (const it of list) {
      textParts.push(`  • Раунд ${it.roundNumber}, №${it.number} «${short(it.description)}» — ${KIND_LABEL[it.kind]}`, `    ${it.url}`);
      htmlParts.push(`<li>Раунд ${it.roundNumber}, <a href="${esc(it.url)}">№${it.number} «${esc(short(it.description))}»</a> — ${KIND_LABEL[it.kind]}</li>`);
    }
    textParts.push('');
    htmlParts.push('</ul>');
  }
  textParts.push(`Письма о том, что вас ждёт, можно выключить в профиле: ${settingsUrl}`);
  htmlParts.push(`<p style="color:#666;font-size:13px">Письма о том, что вас ждёт, можно выключить <a href="${esc(settingsUrl)}">в профиле</a>.</p>`);
  return { to, subject, text: textParts.join('\n'), html: htmlParts.join('\n') };
}

export interface InvitationMailInput {
  to: string;
  projectName: string;
  role: Role;
  inviterName: string;
  url: string;
  expiresAt: Date;
}

export function invitationMail(i: InvitationMailInput): MailMessage {
  const until = i.expiresAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const role = ROLE_LABEL[i.role];
  return {
    to: i.to,
    subject: `RemarkRound: приглашение в проект «${i.projectName}»`,
    text: [`${i.inviterName} зовёт вас в проект «${i.projectName}» — ${role}.`, '', `Войти по ссылке: ${i.url}`, '', `Ссылка действует до ${until}. Если приглашение не для вас — просто не открывайте её.`].join('\n'),
    html: [`<p>${esc(i.inviterName)} зовёт вас в проект «${esc(i.projectName)}» — ${role}.</p>`, `<p><a href="${esc(i.url)}">Войти по ссылке</a></p>`, `<p style="color:#666;font-size:13px">Ссылка действует до ${until}. Если приглашение не для вас — просто не открывайте её.</p>`].join('\n'),
  };
}

export interface InstanceInvitationMailInput {
  to: string;
  inviterName: string;
  url: string;
  expiresAt: Date;
}

/** Администратор зовёт руководителя приёмки без проекта (ADR 006, 17.09): по ссылке появляется право создавать проекты. */
export function instanceInvitationMail(i: InstanceInvitationMailInput): MailMessage {
  const until = i.expiresAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return {
    to: i.to,
    subject: 'RemarkRound: приглашение руководителя приёмки',
    text: [`${i.inviterName} приглашает вас в RemarkRound руководителем приёмки: вы сможете создавать проекты и звать участников.`, '', `Войти по ссылке: ${i.url}`, '', `Ссылка действует до ${until}. Если приглашение не для вас — просто не открывайте её.`].join('\n'),
    html: [`<p>${esc(i.inviterName)} приглашает вас в RemarkRound руководителем приёмки: вы сможете создавать проекты и звать участников.</p>`, `<p><a href="${esc(i.url)}">Войти по ссылке</a></p>`, `<p style="color:#666;font-size:13px">Ссылка действует до ${until}. Если приглашение не для вас — просто не открывайте её.</p>`].join('\n'),
  };
}

export interface MemberAddedMailInput {
  to: string;
  name: string;
  projectName: string;
  role: Role;
  inviterName: string;
  /** Адрес проекта в SPA: `${WEB_ORIGIN}/<slug>`. */
  url: string;
}

/** Зарегистрированного PM добавляет напрямую, без ссылки (ADR 006) — иначе человек узнал бы о проекте, только открыв приложение (I-3). */
export function memberAddedMail(i: MemberAddedMailInput): MailMessage {
  const role = ROLE_LABEL[i.role];
  return {
    to: i.to,
    subject: `RemarkRound: вы в проекте «${i.projectName}»`,
    text: [`${i.name}, здравствуйте.`, '', `${i.inviterName} добавляет вас в проект «${i.projectName}» — ${role}.`, '', `Открыть проект: ${i.url}`].join('\n'),
    html: [`<p>${esc(i.name)}, здравствуйте.</p>`, `<p>${esc(i.inviterName)} добавляет вас в проект «${esc(i.projectName)}» — ${role}.</p>`, `<p><a href="${esc(i.url)}">Открыть проект</a></p>`].join('\n'),
  };
}

export interface PasswordResetMailInput {
  to: string;
  name: string;
  url: string;
  expiresAt: Date;
}

/** «Забыли пароль» (ADR 012): ссылка живёт час; кто не просил — просто не открывает, пароль остаётся прежним. */
export function passwordResetMail(i: PasswordResetMailInput): MailMessage {
  const until = i.expiresAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return {
    to: i.to,
    subject: 'RemarkRound: смена пароля',
    text: [`${i.name}, здравствуйте.`, '', 'Кто-то (надеемся, вы) попросил сменить пароль в RemarkRound.', '', `Задать новый пароль: ${i.url}`, '', `Ссылка действует час (до ${until} UTC). Если это не вы — просто не открывайте её: пароль останется прежним.`].join('\n'),
    html: [`<p>${esc(i.name)}, здравствуйте.</p>`, '<p>Кто-то (надеемся, вы) попросил сменить пароль в RemarkRound.</p>', `<p><a href="${esc(i.url)}">Задать новый пароль</a></p>`, `<p style="color:#666;font-size:13px">Ссылка действует час (до ${until} UTC). Если это не вы — просто не открывайте её: пароль останется прежним.</p>`].join('\n'),
  };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
