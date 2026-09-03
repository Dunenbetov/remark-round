import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, homeUrl, projectGuard, roleGuard } from './core/guards';
import { DOCUMENTS, EMPTY, IMPORT, LOGIN, NAV, NEW_REMARK } from './core/copy';
import { SessionService } from './core/session.service';
import { DevQueuePage } from './pages/dev-queue-page';
import { DocumentsPage } from './pages/documents-page';
import { ImportPage } from './pages/import-page';
import { JournalPage } from './pages/journal-page';
import { LoginPage } from './pages/login-page';
import { NewRemarkPage } from './pages/new-remark-page';
import { NoAccessPage } from './pages/no-access-page';
import { RemarkCardPage } from './pages/remark-card-page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, title: LOGIN.pageTitle },
  { path: 'no-access', component: NoAccessPage, title: EMPTY.noAccess },
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
      { path: 'dev', component: DevQueuePage, title: NAV.dev, canActivate: [roleGuard('developer')] },
    ],
  },
  { path: '**', redirectTo: '' },
];
