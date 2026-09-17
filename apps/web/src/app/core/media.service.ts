import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/**
 * Кадры отдаются API только с токеном, а <img src> заголовков не шлёт.
 * Поэтому грузим blob через HttpClient и отдаём object URL. Кэш на сессию.
 */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly api = inject(ApiService);
  private readonly cache = new Map<string, WritableSignal<string | null>>();

  objectUrl(apiUrl: string): Signal<string | null> {
    let entry = this.cache.get(apiUrl);
    if (!entry) {
      entry = signal<string | null>(null);
      this.cache.set(apiUrl, entry);
      const target = entry;
      void this.api
        .mediaBlob(apiUrl)
        .then((blob) => target.set(URL.createObjectURL(blob)))
        .catch(() => target.set(null));
    }
    return entry.asReadonly();
  }
}
