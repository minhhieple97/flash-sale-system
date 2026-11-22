import { SaleMutationLock } from '../../src/modules/admin/services/sale-mutation-lock.service';
import { type Deferred, deferred } from '../support/deferred';

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function tracked(events: string[], name: string, gate: Deferred): () => Promise<string> {
  return async () => {
    events.push(`${name}:start`);
    await gate.promise;
    events.push(`${name}:end`);
    return name;
  };
}

describe('SaleMutationLock', () => {
  it('runs exclusive tasks one at a time in call order', async () => {
    const lock = new SaleMutationLock();
    const events: string[] = [];
    const gateA = deferred();
    const gateB = deferred();

    const a = lock.runExclusive(tracked(events, 'a', gateA));
    const b = lock.runExclusive(tracked(events, 'b', gateB));
    await flush();
    gateA.resolve();
    await a;
    await flush();

    expect(events).toEqual(['a:start', 'a:end', 'b:start']);
    gateB.resolve();
    await expect(b).resolves.toBe('b');
  });

  it('runs the next task after a rejected one', async () => {
    const lock = new SaleMutationLock();
    const failure = new Error('reset failed');

    const first = lock.runExclusive(async () => {
      throw failure;
    });
    const second = lock.runExclusive(async () => 'next');

    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe('next');
  });

  it('skips runIfIdle while a task runs or waits, without queuing it', async () => {
    const lock = new SaleMutationLock();
    const gate = deferred();
    const skipped = jest.fn(async () => 'tick');
    const running = lock.runExclusive(async () => gate.promise);
    const waiting = lock.runExclusive(async () => undefined);

    const whileRunning = await lock.runIfIdle(skipped);
    gate.resolve();
    await running;
    const whileWaiting = await lock.runIfIdle(skipped);
    await waiting;
    await flush();

    expect(whileRunning).toEqual({ ran: false });
    expect(whileWaiting).toEqual({ ran: false });
    expect(skipped).not.toHaveBeenCalled();
  });

  it('runs runIfIdle when nothing runs and returns ran: true with the value', async () => {
    const lock = new SaleMutationLock();

    const attempt = await lock.runIfIdle(async () => 42);

    expect(attempt).toEqual({ ran: true, value: 42 });
  });

  it('queues runExclusive behind a running runIfIdle task', async () => {
    const lock = new SaleMutationLock();
    const events: string[] = [];
    const tickGate = deferred();
    const resetGate = deferred();

    const tick = lock.runIfIdle(tracked(events, 'tick', tickGate));
    const reset = lock.runExclusive(tracked(events, 'reset', resetGate));
    await flush();
    tickGate.resolve();
    await tick;
    await flush();
    resetGate.resolve();
    await reset;

    expect(events).toEqual(['tick:start', 'tick:end', 'reset:start', 'reset:end']);
  });

  it('frees the lock for runIfIdle once a rejected runIfIdle task settles', async () => {
    const lock = new SaleMutationLock();
    const failure = new Error('sweep failed');

    const failed = lock.runIfIdle(async () => {
      throw failure;
    });
    await expect(failed).rejects.toBe(failure);
    const next = await lock.runIfIdle(async () => 'ok');

    expect(next).toEqual({ ran: true, value: 'ok' });
  });
});
