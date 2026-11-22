import { Injectable } from '@nestjs/common';
import type { LockAttempt } from '../interfaces/admin.interface';

@Injectable()
export class SaleMutationLock {
  private tail: Promise<unknown> = Promise.resolve();
  private occupancy = 0;

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    this.occupancy += 1;
    const run = this.tail
      .then(() => task())
      .finally(() => {
        this.occupancy -= 1;
      });
    this.tail = run.catch(() => undefined);
    return run;
  }

  async runIfIdle<T>(task: () => Promise<T>): Promise<LockAttempt<T>> {
    if (this.occupancy > 0) return { ran: false };
    return { ran: true, value: await this.runExclusive(task) };
  }
}
