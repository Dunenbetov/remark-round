import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { AccountService } from './core/account.service';
import { authInterceptor } from './core/api.service';
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
    // Свежие membership при старте: человека могли добавить в проект, пока вкладка была закрыта (ADR 005)
    provideAppInitializer(() => inject(AccountService).refresh().then(() => undefined)),
  ],
};
