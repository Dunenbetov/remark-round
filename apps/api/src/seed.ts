/**
 * Демо-данные: три роли в проекте «Клиентский кабинет», чужой проект для проверки утечки,
 * пакет документов из fixtures/spec и fixtures/protocol. Пароль у всех — `remarkround` (только локально).
 * Если задан OPENAI_API_KEY, документы сразу индексируются (chunk → embed → pgvector).
 * Запуск: DATABASE_URL=... pnpm --filter @remarkround/api seed
 */
import { PrismaClient, type DocumentKind, type Role } from '@remarkround/db';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashPassword } from './auth/password';
import { JobsService } from './jobs/jobs.service';
import { EmbeddingsService } from './llm/embeddings.service';
import { PrismaService } from './prisma/prisma.service';
import { RagService } from './rag/rag.service';
import { StorageService } from './storage/storage.service';
import { seedRemarks } from './seed-remarks';

const ROOT = resolve(__dirname, '../../..');

export const SEED = {
  projectId: '11111111-1111-4111-8111-111111111111',
  otherProjectId: '22222222-2222-4222-8222-222222222222',
  password: 'remarkround',
  users: [
    // Демо-персоны названы ролями — на защите сразу видно, кто есть кто. Реальные люди регистрируются под своими именами.
    { id: 'a1111111-1111-4111-8111-111111111111', email: 'pm@remarkround.dev', name: 'PM', role: 'pm' as Role },
    { id: 'a2222222-2222-4222-8222-222222222222', email: 'business@remarkround.dev', name: 'Business', role: 'business' as Role },
    { id: 'a3333333-3333-4333-8333-333333333333', email: 'developer@remarkround.dev', name: 'Developer', role: 'developer' as Role },
  ],
  otherUser: { id: 'b1111111-1111-4111-8111-111111111111', email: 'other@other-tenant.dev', name: 'Чужой', role: 'admin' as Role },
  documents: [
    { id: 'd1111111-1111-4111-8111-111111111111', projectId: '11111111-1111-4111-8111-111111111111', kind: 'spec' as DocumentKind, title: 'ТЗ_Клиентский_кабинет_v1.4.md', fixture: 'fixtures/spec/TZ.md', effectiveAt: '2026-01-14' },
    { id: 'd1111111-1111-4111-8111-222222222222', projectId: '11111111-1111-4111-8111-111111111111', kind: 'protocol' as DocumentKind, title: 'Протокол_12.03.md', fixture: 'fixtures/protocol/PROTOCOL.md', effectiveAt: '2026-03-12' },
    { id: 'd2222222-2222-4222-8222-111111111111', projectId: '22222222-2222-4222-8222-222222222222', kind: 'spec' as DocumentKind, title: 'ТЗ_чужого_проекта.md', fixture: 'fixtures/spec/TZ.md', effectiveAt: '2026-01-14' },
  ],
};

export async function seed(prisma: PrismaClient, options: { index?: boolean } = {}): Promise<void> {
  const passwordHash = await hashPassword(SEED.password);
  const storage = new StorageService();

  await prisma.project.upsert({
    where: { id: SEED.projectId },
    create: { id: SEED.projectId, name: 'Клиентский кабинет' },
    update: { name: 'Клиентский кабинет' },
  });
  await prisma.project.upsert({
    where: { id: SEED.otherProjectId },
    create: { id: SEED.otherProjectId, name: 'Чужой проект' },
    update: {},
  });

  for (const u of SEED.users) {
    // upsert по id: e-mail и имя демо-персон менялись, на существующей БД запись обновляется на месте
    await prisma.user.upsert({
      where: { id: u.id },
      create: { id: u.id, email: u.email, name: u.name, passwordHash, preferredRole: u.role, canCreateProjects: u.role === 'pm' },
      update: { email: u.email, name: u.name, passwordHash, preferredRole: u.role, canCreateProjects: u.role === 'pm' },
    });
    await prisma.membership.upsert({
      where: { userId_projectId: { userId: u.id, projectId: SEED.projectId } },
      create: { userId: u.id, projectId: SEED.projectId, role: u.role },
      update: { role: u.role },
    });
  }
  const o = SEED.otherUser;
  await prisma.user.upsert({
    where: { email: o.email },
    create: { id: o.id, email: o.email, name: o.name, passwordHash },
    update: { passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_projectId: { userId: o.id, projectId: SEED.otherProjectId } },
    create: { userId: o.id, projectId: SEED.otherProjectId, role: o.role },
    update: {},
  });

  for (const d of SEED.documents) {
    const data = await readFile(resolve(ROOT, d.fixture));
    const storageKey = await storage.save(d.projectId, d.title, data);
    await prisma.document.upsert({
      where: { id: d.id },
      create: { id: d.id, projectId: d.projectId, kind: d.kind, title: d.title, mime: 'text/markdown', storageKey, status: 'uploaded', effectiveAt: new Date(d.effectiveAt) },
      update: { title: d.title, mime: 'text/markdown', storageKey, status: 'uploaded', effectiveAt: new Date(d.effectiveAt) },
    });
  }

  const embeddings = new EmbeddingsService();
  const shouldIndex = options.index ?? embeddings.available;
  if (shouldIndex) {
    // Сид индексирует прямо здесь, воркер очереди не запускается (onModuleInit не вызывается)
    const rag = new RagService(prisma as PrismaService, storage, embeddings, new JobsService(prisma as PrismaService));
    for (const d of SEED.documents) {
      const result = await rag.indexDocument(d.id);
      console.log(`seed: indexed ${d.title} — ${result.chunks} chunks`);
    }
  } else {
    console.log('seed: OPENAI_API_KEY не задан, документы оставлены в статусе uploaded');
  }

  await seedRemarks(prisma, {
    projectId: SEED.projectId,
    specDocumentId: SEED.documents[0]!.id,
    protocolDocumentId: SEED.documents[1]!.id,
    pmId: SEED.users[0]!.id,
    businessId: SEED.users[1]!.id,
    developerId: SEED.users[2]!.id,
  });
}

if (require.main === module) {
  // Демо-данные и пароль `remarkround` — не для прода (фаза 11): в production seed отказывается,
  // если это не сделано осознанно через SEED_FORCE=1.
  if (process.env['NODE_ENV'] === 'production' && process.env['SEED_FORCE'] !== '1') {
    console.error('seed: отказ — NODE_ENV=production. Демо-персоны с известным паролем не для прода; SEED_FORCE=1, если осознанно.');
    process.exitCode = 2;
  } else {
    const prisma = new PrismaService();
    seed(prisma)
      .then(() => console.log('seed: ok'))
      .catch((e: unknown) => {
        console.error(e);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}
