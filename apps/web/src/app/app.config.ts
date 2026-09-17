import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { AccountService } from './core/account.service';
import { ApiService, authInterceptor } from './core/api.service';
import { ReportingErrorHandler, initErrorReporting } from './core/error-reporting';
import { RrTitleStrategy } from './core/title.strategy';
import { onViewTransitionCreated } from './core/view-transitions';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      withViewTransitions({ skipInitialTransition: true, onViewTransitionCreated }),
    ),
    { provide: TitleStrategy, useClass: RrTitleStrategy },
    // Ошибки фронта — в Sentry, если сервер отдал DSN (R-L5); без него обработчик ведёт себя как стандартный
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideAppInitializer(() =>
      inject(ApiService)
        .authOptions()
        .then((o) => initErrorReporting(o))
        .catch(() => undefined),
    ),
    // Свежие membership при старте: человека могли добавить в проект, пока вкладка была закрыта (ADR 005)
    provideAppInitializer(() => inject(AccountService).refresh().then(() => undefined)),
  ],
};
