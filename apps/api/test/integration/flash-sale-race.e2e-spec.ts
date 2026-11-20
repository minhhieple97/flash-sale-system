import { type E2eApp, type HttpReply, startE2eApp } from '../support/e2e-app.harness';

const ACTIVE_WINDOW = { startsOffsetSeconds: -60, durationSeconds: 3600 };
const BUYERS = 100;
const STOCK = 10;
const SAME_USER_REQUESTS = 50;
const RACER_VARIANTS = ['Racer@Example.com', '  racer@example.com', 'RACER@EXAMPLE.COM '];
const RACER = 'racer@example.com';

function countByStatus(replies: HttpReply[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const reply of replies) counts[reply.status] = (counts[reply.status] ?? 0) + 1;
  return counts;
}

describe('flash sale races over HTTP (e2e)', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await startE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sells exactly the stock to 100 parallel buyers and confirms every winner', async () => {
    await app.reset({ totalStock: STOCK, ...ACTIVE_WINDOW });
    const users = Array.from({ length: BUYERS }, (_, index) => `buyer-${index}@example.com`);

    const replies = await Promise.all(users.map((userId) => app.purchase({ userId })));
    const rows = await app.waitForOrderRows(STOCK);
    const winners = replies.filter((reply) => reply.status === 202);
    const lookups = await Promise.all(
      winners.map((reply) => app.waitForConfirmed(String(reply.body.userId))),
    );

    expect(countByStatus(replies)).toEqual({ 202: STOCK, 410: BUYERS - STOCK });
    expect(
      replies.filter((reply) => reply.status === 410).every((r) => r.body.code === 'SOLD_OUT'),
    ).toBe(true);
    expect(rows).toHaveLength(STOCK);
    expect(await app.remainingStockInDb()).toBe(0);
    expect(await app.stockInRedis()).toBe('0');
    expect(lookups.map((lookup) => lookup.body.orderId).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );
  });

  it('lets one user win exactly once across 50 parallel case and whitespace variants', async () => {
    await app.reset({ totalStock: 20, ...ACTIVE_WINDOW });

    const replies = await Promise.all(
      Array.from({ length: SAME_USER_REQUESTS }, (_, index) =>
        app.purchase({ userId: RACER_VARIANTS[index % RACER_VARIANTS.length] }),
      ),
    );
    const rows = await app.waitForOrderRows(1);
    await app.waitForConfirmed(RACER);

    expect(countByStatus(replies)).toEqual({ 202: 1, 409: SAME_USER_REQUESTS - 1 });
    expect(
      replies
        .filter((reply) => reply.status === 409)
        .every((r) => r.body.code === 'ALREADY_PURCHASED'),
    ).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(RACER);
    expect(await app.remainingStockInDb()).toBe(19);
    expect(await app.stockInRedis()).toBe('19');
  });
});
