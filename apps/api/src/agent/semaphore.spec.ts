import { Semaphore } from './semaphore';

describe('semaphore', () => {
  it('второй прогон ждёт первый при лимите 1; release идемпотентен', async () => {
    const sem = new Semaphore(1);
    const release1 = await sem.acquire();
    let second = false;
    const p = sem.acquire().then((release) => {
      second = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(second).toBe(false);
    expect(sem.pending).toBe(1);
    release1();
    release1();
    const release2 = await p;
    expect(second).toBe(true);
    release2();
    expect(sem.idle).toBe(true);
  });

  it('лимит 2 пускает двоих сразу', async () => {
    const sem = new Semaphore(2);
    const a = await sem.acquire();
    const b = await sem.acquire();
    expect(sem.pending).toBe(0);
    a();
    b();
    expect(sem.idle).toBe(true);
  });
});
