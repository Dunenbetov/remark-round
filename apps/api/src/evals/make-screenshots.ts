/**
 * Скриншоты UI для README (docs/screenshots): headless Chrome через CDP, без Playwright.
 * Нужен поднятый стенд (docker compose up): web на WEB_URL, api на API_URL, seed-пользователи.
 *   pnpm --filter @remarkround/api exec tsx src/evals/make-screenshots.ts
 * OUT_DIR=… — другая папка (раунды критика), ONLY=journal,remark-card — только эти кадры.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const CHROME = process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB = process.env['WEB_URL'] ?? 'http://localhost:4200';
const API = process.env['API_URL'] ?? 'http://localhost:3001/api/v1';
const OUT = process.env['OUT_DIR'] ? resolve(process.env['OUT_DIR']) : resolve(__dirname, '../../../../docs/screenshots');
/** ONLY=journal,remark-card — снять только эти кадры (по имени файла без .png). */
const ONLY = new Set((process.env['ONLY'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const PORT = 9333;

interface Shot {
  file: string;
  path: (ctx: { projectId: string; remarks: Array<{ id: string; number: number; status: string }> }) => string;
  as: 'pm' | 'business' | 'developer' | null;
  width?: number;
  height?: number;
  /** Тёмная тема (localStorage rr.theme = dark). */
  dark?: boolean;
  /** Снимок очереди «Ждут вас» в sessionStorage — карточка покажет рельс «i из N». */
  queue?: boolean;
}

const byNumber = (remarks: Array<{ id: string; number: number }>, n: number) => remarks.find((r) => r.number === n)!.id;

const SHOTS: Shot[] = [
  { file: 'login.png', path: () => `/login`, as: null },
  { file: 'journal.png', path: ({ projectId }) => `/p/${projectId}/r/2`, as: 'pm' },
  { file: 'remark-card.png', path: ({ projectId, remarks }) => `/p/${projectId}/r/2/remarks/${byNumber(remarks, 12)}`, as: 'pm', height: 1000, queue: true },
  { file: 'remark-card-dark.png', path: ({ projectId, remarks }) => `/p/${projectId}/r/2/remarks/${byNumber(remarks, 12)}`, as: 'pm', height: 1000, dark: true, queue: true },
  { file: 'retest.png', path: ({ projectId, remarks }) => `/p/${projectId}/r/2/remarks/${byNumber(remarks, 2)}`, as: 'business', height: 900 },
  { file: 'documents.png', path: ({ projectId }) => `/p/${projectId}/documents`, as: 'pm' },
  { file: 'import.png', path: ({ projectId }) => `/p/${projectId}/r/2/import`, as: 'business' },
  { file: 'new-remark.png', path: ({ projectId }) => `/p/${projectId}/r/2/remarks/new`, as: 'business' },
  { file: 'dev-queue.png', path: ({ projectId }) => `/p/${projectId}/dev`, as: 'developer' },
  { file: 'dev-card.png', path: ({ projectId, remarks }) => `/p/${projectId}/r/2/remarks/${byNumber(remarks, 5)}`, as: 'developer', height: 900 },
  { file: 'dev-advice.png', path: ({ projectId, remarks }) => `/p/${projectId}/r/2/remarks/${byNumber(remarks, 14)}`, as: 'developer', height: 900 },
];

async function login(email: string): Promise<{ session: unknown; projectId: string; token: string }> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'remarkround' }) });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  const body = (await res.json()) as { accessToken: string; user: unknown; memberships: Array<{ projectId: string }> };
  return { session: { accessToken: body.accessToken, user: body.user, memberships: body.memberships }, projectId: body.memberships[0]!.projectId, token: body.accessToken };
}

class Cdp {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (v: unknown) => void>();
  private events = new Map<string, () => void>();

  async connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);
    await new Promise<void>((ok, fail) => {
      this.ws.onopen = () => ok();
      this.ws.onerror = (e) => fail(e);
    });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { id?: number; method?: string; result?: unknown };
      if (msg.id && this.pending.has(msg.id)) this.pending.get(msg.id)!(msg.result);
      if (msg.method && this.events.has(msg.method)) this.events.get(msg.method)!();
    };
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((ok) => this.pending.set(id, ok as (v: unknown) => void));
  }

  once(method: string): Promise<void> {
    return new Promise<void>((ok) => this.events.set(method, ok));
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const pm = await login('pm@remarkround.dev');
  const rounds = (await (await fetch(`${API}/projects/${pm.projectId}/rounds`, { headers: { Authorization: `Bearer ${pm.token}` } })).json()) as Array<{ id: string; number: number }>;
  const round2 = rounds.find((r) => r.number === 2)!;
  const remarks = (await (await fetch(`${API}/projects/${pm.projectId}/rounds/${round2.id}/remarks`, { headers: { Authorization: `Bearer ${pm.token}` } })).json()) as Array<{ id: string; number: number; status: string }>;
  const sessions = { pm: pm.session, business: (await login('business@remarkround.dev')).session, developer: (await login('developer@remarkround.dev')).session };

  const profile = mkdtempSync(resolve(tmpdir(), 'rr-shots-'));
  const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json() as Promise<Array<{ type: string; webSocketDebuggerUrl: string }>>).then((list) => list.find((t) => t.type === 'page')).catch(() => undefined);
    }
    if (!target) throw new Error('Chrome не поднял CDP');
    const cdp = new Cdp();
    await cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    for (const shot of SHOTS) {
      if (ONLY.size && !ONLY.has(shot.file.replace(/\.png$/, ""))) continue;
      const width = shot.width ?? 1440;
      const height = shot.height ?? 900;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      // Сессия — в localStorage той же origin: сначала пустая страница приложения, потом нужный маршрут.
      // сначала выходим: иначе /login с живой сессией редиректит в журнал и перезаписывает rr.session после нашего setItem
      const loaded0 = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${WEB}/login` });
      await loaded0;
      await cdp.send('Runtime.evaluate', { expression: `localStorage.removeItem('rr.session'); sessionStorage.clear();` });
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${WEB}/login` });
      await loaded;
      await sleep(300);
      const session = shot.as ? `localStorage.setItem('rr.session', ${JSON.stringify(JSON.stringify(sessions[shot.as]))}); localStorage.setItem('rr.project', ${JSON.stringify(pm.projectId)});` : `localStorage.removeItem('rr.session');`;
      const theme = shot.dark ? `localStorage.setItem('rr.theme', 'dark');` : `localStorage.removeItem('rr.theme');`;
      // подсказки первого захода закрываем, чтобы скрины были «рабочими» (ключи — на пользователя: rr.hint.<userId>.<key>)
      const userId = shot.as ? (sessions[shot.as] as { user: { id: string } }).user.id : '';
      const hints = ['journal.pm', 'journal.business', 'card.pm', 'card.business', 'card.developer', 'tour.pm', 'tour.business'].map((k) => `localStorage.setItem('rr.hint.${userId}.${k}', '1');`).join('');
      // очередь «Ждут вас»: все awaiting_pm по убыванию номера, как в журнале
      const waiting = remarks.filter((r) => r.status === 'awaiting_pm').sort((a, b) => b.number - a.number).map((r) => r.id);
      const queue = shot.queue ? `sessionStorage.setItem('rr.queue', ${JSON.stringify(JSON.stringify({ ids: waiting, label: 'Ждут вас', backLink: ['/p', pm.projectId, 'r', 2] }))});` : `sessionStorage.removeItem('rr.queue');`;
      await cdp.send('Runtime.evaluate', { expression: session + theme + hints + queue });
      const loaded2 = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${WEB}${shot.path({ projectId: pm.projectId, remarks })}` });
      await loaded2;
      await sleep(2500);
      const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(resolve(OUT, shot.file), Buffer.from(data, 'base64'));
      console.log(`${shot.file} ${width}×${height}@2x как ${shot.as ?? 'гость'}${shot.dark ? ' · тёмная' : ''}`);
    }
    cdp.close();
  } finally {
    chrome.kill();
    // Chrome дописывает профиль после SIGTERM: ждём, потом чистим.
    await sleep(1000);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((e: Error) => {
  console.error(e);
  process.exitCode = 1;
});
