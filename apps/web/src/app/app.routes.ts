import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, homeUrl, instanceAdminGuard, projectGuard, roleGuard } from './core/guards';
import { ADMIN, DOCUMENTS, EMPTY, IMPORT, JOIN, LOGIN, NAV, NEW_REMARK, PROFILE, PROJECTS, REGISTER, TEAM } from './core/copy';
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
  {
    path: 'p/:projectId',
    canActivate: [authGuard, projectGuard],
    children: [
      { path: 'r/:round', component: JournalPage, title: NAV.journal, canActivate: [roleGuard('pm', 'business', 'admin')] },
      { path: 'r/:round/remarks/new', component: NewRemarkPage, title: NEW_REMARK.title, canActivate: [roleGuard('business', 'pm')] },
      { path: 'r/:round/remarks/:remarkId', component: RemarkCardPage },
      { path: 'r/:round/import', component: ImportPage, title: IMPORT.title, canActivate: [roleGuard('business', 'pm')] },
      { path: 'documents', component: DocumentsPage, title: DOCUMENTS.title, canActivate: [roleGuard('pm', 'business', 'admin')] },
      { path: 'team', component: TeamPage, title: TEAM.title, canActivate: [roleGuard('pm', 'admin')] },
      { path: 'dev', component: DevQueuePage, title: NAV.dev, canActivate: [roleGuard('developer')] },
    ],
  },
  { path: '**', redirectTo: '' },
];
