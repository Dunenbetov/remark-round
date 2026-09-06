/**
 * Очередь на прогоны графа (фаза 11): FIFO-семафор без внешних зависимостей. Один инстанс API —
 * одна очередь; при втором инстансе нужна внешняя (BullMQ), это отдельный этап.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit: number) {}

  /** Ждёт свободный слот; возвращает release, который безопасно звать один раз. */
  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }

  get idle(): boolean {
    return this.active === 0 && this.waiting.length === 0;
  }

  get pending(): number {
    return this.waiting.length;
  }
}
