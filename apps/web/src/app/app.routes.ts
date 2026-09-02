import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard, homeUrl, projectGuard, roleGuard } from './core/guards';
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
  { path: 'login', component: LoginPage },
  { path: 'no-access', component: NoAccessPage },
  { path: '', pathMatch: 'full', redirectTo: () => homeUrl(inject(SessionService)) },
  {
    path: 'p/:projectId',
    canActivate: [authGuard, projectGuard],
    children: [
      { path: 'r/:round', component: JournalPage, canActivate: [roleGuard('pm', 'business', 'admin')] },
      { path: 'r/:round/remarks/new', component: NewRemarkPage, canActivate: [roleGuard('business', 'pm')] },
      { path: 'r/:round/remarks/:remarkId', component: RemarkCardPage },
      { path: 'r/:round/import', component: ImportPage, canActivate: [roleGuard('business', 'pm')] },
      { path: 'documents', component: DocumentsPage, canActivate: [roleGuard('pm', 'business', 'admin')] },
      { path: 'dev', component: DevQueuePage, canActivate: [roleGuard('developer')] },
    ],
  },
  { path: '**', redirectTo: '' },
];
