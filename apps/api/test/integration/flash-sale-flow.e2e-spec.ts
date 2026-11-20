import { type E2eApp, startE2eApp } from '../support/e2e-app.harness';

const ACTIVE_WINDOW = { startsOffsetSeconds: -60, durationSeconds: 3600 };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALICE = 'alice@example.com';

describe('flash sale flow over HTTP (e2e)', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await startE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.reset({ totalStock: 20, ...ACTIVE_WINDOW });
  });

  it('rejects a purchase with 422 SALE_UPCOMING before the window opens and keeps the stock', async () => {
    await app.reset({ totalStock: 20, startsOffsetSeconds: 3600 });

    const reply = await app.purchase({ userId: ALICE });

    expect(reply.status).toBe(422);
    expect(reply.body.code).toBe('SALE_UPCOMING');
    expect(await app.stockInRedis()).toBe('20');
    expect(await app.orderRows()).toEqual([]);
  });

  it('rejects a purchase with 422 SALE_ENDED after the window closes and keeps the stock', async () => {
    await app.reset({ totalStock: 20, startsOffsetSeconds: -7200, durationSeconds: 3600 });

    const reply = await app.purchase({ userId: ALICE });

    expect(reply.status).toBe(422);
    expect(reply.body.code).toBe('SALE_ENDED');
    expect(await app.stockInRedis()).toBe('20');
    expect(await app.orderRows()).toEqual([]);
  });

  it('answers 202 RESERVED and then confirms the order in PostgreSQL and Redis', async () => {
    const reply = await app.purchase({ userId: ALICE });
    const orderId = String(reply.body.orderId);
    const confirmed = await app.waitForConfirmed(ALICE);
    const rows = await app.orderRows();

    expect(reply.status).toBe(202);
    expect(reply.body).toEqual({
      code: 'RESERVED',
      orderId: expect.stringMatching(UUID_PATTERN),
      userId: ALICE,
      message: expect.any(String),
    });
    expect(confirmed.body).toMatchObject({ orderId, hasPurchased: true, status: 'CONFIRMED' });
    expect(rows).toEqual([{ id: orderId, user_id: ALICE, status: 'CONFIRMED' }]);
    expect(await app.remainingStockInDb()).toBe(19);
    expect(await app.stockInRedis()).toBe('19');
  });

  it('answers 409 ALREADY_PURCHASED for a case and whitespace variant and finds the same order', async () => {
    const first = await app.purchase({ userId: ALICE });

    const duplicate = await app.purchase({ userId: '  ALICE@example.com ' });
    const lookup = await app.lookup('ALICE@Example.com');

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ALREADY_PURCHASED');
    expect(lookup.body).toMatchObject({ userId: ALICE, orderId: first.body.orderId });
    await app.waitForConfirmed(ALICE);
    expect(await app.stockInRedis()).toBe('19');
  });

  it.each([
    ['a malformed id', { userId: 'a!' }],
    ['an empty body', {}],
  ])('answers 400 INVALID_USER_ID for %s', async (_name, body) => {
    const reply = await app.purchase(body);

    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe('INVALID_USER_ID');
    expect(await app.stockInRedis()).toBe('20');
  });

  it('lets a user who bought before buy again after a reset and confirms the new order', async () => {
    const first = await app.purchase({ userId: ALICE });
    await app.waitForConfirmed(ALICE);
    await app.reset({ totalStock: 20, ...ACTIVE_WINDOW });

    const second = await app.purchase({ userId: ALICE });
    const confirmed = await app.waitForConfirmed(ALICE);

    expect(second.status).toBe(202);
    expect(second.body.orderId).not.toBe(first.body.orderId);
    expect(confirmed.body.orderId).toBe(second.body.orderId);
    expect(await app.orderRows()).toEqual([
      { id: second.body.orderId, user_id: ALICE, status: 'CONFIRMED' },
    ]);
    expect(await app.remainingStockInDb()).toBe(19);
  });

  it('answers 503 TEMPORARY_FAILURE when the sale config is missing and recovers on reset', async () => {
    await app.deleteConfigKey();

    const failed = await app.purchase({ userId: ALICE });
    await app.reset({ totalStock: 20, ...ACTIVE_WINDOW });
    const recovered = await app.purchase({ userId: ALICE });

    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('TEMPORARY_FAILURE');
    expect(recovered.status).toBe(202);
    await app.waitForConfirmed(ALICE);
  });
});
