import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, homeUrl, instanceAdminGuard, legacyUrlGuard, projectGuard, projectHomeGuard, projectIdResolver, remarkIdResolver, roleGuard } from './core/guards';
import { legacyMatcher, remarkMatcher, roundMatcher } from './core/links';
import { ADMIN, DOCUMENTS, EMPTY, IMPORT, JOIN, LOGIN, NAV, NEW_REMARK, PROFILE, PROJECTS, REGISTER, ROUNDS, TEAM } from './core/copy';
import { SessionService } from './core/session.service';
import { AdminPage } from './pages/admin-page';
import { DevQueuePage } from './pages/dev-queue-page';
import { DocumentsPage } from './pages/documents-page';
import { ImportPage } from './pages/import-page';
import { JoinPage } from './pages/join-page';
import { JournalPage } from './pages/journal-page';
import { LoginPage } from './pages/login-page';
import { NewRemarkPage } from './pages/new-remark-page';
import { NoAccessPage } from './pages/no-access-page';
import { ProfilePage } from './pages/profile-page';
import { ProjectsPage } from './pages/projects-page';
import { RegisterPage } from './pages/register-page';
import { RemarkCardPage } from './pages/remark-card-page';
import { RoundsPage } from './pages/rounds-page';
import { TeamPage } from './pages/team-page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, title: LOGIN.pageTitle },
  { path: 'register', component: RegisterPage, title: REGISTER.pageTitle },
  // Ссылка приглашения: вошедший принимает, остальные — на регистрацию или вход
  { path: 'join/:token', component: JoinPage, title: JOIN.title },
  { path: 'no-access', component: NoAccessPage, title: EMPTY.noAccess },
  // Без проекта — ожидание или создание; с проектами — список
  { path: 'projects', component: ProjectsPage, title: PROJECTS.title, canActivate: [authGuard] },
  { path: 'profile', component: ProfilePage, title: PROFILE.title, canActivate: [authGuard] },
  // Администрирование инстанса (ADR 006): люди и проекты поперёк тенантов
  { path: 'admin', component: AdminPage, title: ADMIN.title, canActivate: [instanceAdminGuard] },
  { path: '', pathMatch: 'full', redirectTo: () => homeUrl(inject(SessionService)) },
  // Старые ссылки /p/<uuid>/… (письма, закладки) → человеческий адрес
  { matcher: legacyMatcher, canActivate: [authGuard, legacyUrlGuard], component: NoAccessPage },
  // Проект по slug: /klientskiy-kabinet/round-2/12 (core/links.ts). Страницы получают projectId резолвером — API живёт на id.
  {
    path: ':project',
    canActivate: [authGuard, projectGuard],
    resolve: { projectId: projectIdResolver },
    children: [
      { path: '', pathMatch: 'full', component: JournalPage, title: NAV.journal, data: { round: 'latest' }, canActivate: [projectHomeGuard, roleGuard('pm', 'business', 'admin')] },
      { path: 'documents', component: DocumentsPage, title: DOCUMENTS.title, canActivate: [roleGuard('pm', 'business', 'admin')] },
      { path: 'team', component: TeamPage, title: TEAM.title, canActivate: [roleGuard('pm', 'admin')] },
      { path: 'dev', component: DevQueuePage, title: NAV.dev, canActivate: [roleGuard('developer')] },
      { path: 'rounds', component: RoundsPage, title: ROUNDS.title, canActivate: [roleGuard('pm', 'business', 'admin')] },
      {
        matcher: roundMatcher,
        children: [
          { path: '', pathMatch: 'full', component: JournalPage, title: NAV.journal, canActivate: [roleGuard('pm', 'business', 'admin')] },
          { path: 'new', component: NewRemarkPage, title: NEW_REMARK.title, canActivate: [roleGuard('business', 'pm')] },
          { path: 'import', component: ImportPage, title: IMPORT.title, canActivate: [roleGuard('business', 'pm')] },
          { matcher: remarkMatcher, component: RemarkCardPage, resolve: { remarkId: remarkIdResolver } },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
