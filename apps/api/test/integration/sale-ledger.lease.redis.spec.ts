import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../src/config/app-config.module';
import { SaleLedgerLeaseRepository, SaleLedgerModule } from '../../src/modules/sale-ledger';
import {
  flashSaleMaintenanceLockKey,
  SALE_LEDGER_REDIS,
  type SaleLedgerRedis,
} from '../support/ledger-keys';

describe('SaleLedgerLeaseRepository against Redis', () => {
  let moduleRef: TestingModule;
  let redis: SaleLedgerRedis;
  let leases: SaleLedgerLeaseRepository;
  const saleIds: string[] = [];

  const nextSaleId = (): string => {
    const id = randomUUID();
    saleIds.push(id);
    return id;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, SaleLedgerModule],
    }).compile();
    await moduleRef.init();
    redis = moduleRef.get<SaleLedgerRedis>(SALE_LEDGER_REDIS);
    leases = moduleRef.get(SaleLedgerLeaseRepository);
  });

  afterAll(async () => {
    const keys = saleIds.map(flashSaleMaintenanceLockKey);
    if (keys.length > 0) await redis.del(...keys);
    await moduleRef.close();
  });

  it('acquires an unowned lease with PX TTL and rejects competing owners', async () => {
    const saleId = nextSaleId();
    const ownerA = randomUUID();
    const ownerB = randomUUID();

    const acquiredA = await leases.acquireMaintenanceLease({
      saleId,
      ownerToken: ownerA,
      ttlMs: 5_000,
    });
    const acquiredB = await leases.acquireMaintenanceLease({
      saleId,
      ownerToken: ownerB,
      ttlMs: 5_000,
    });

    const lockKey = flashSaleMaintenanceLockKey(saleId);
    expect([acquiredA, acquiredB]).toEqual([true, false]);
    expect(await redis.get(lockKey)).toBe(ownerA);
    expect(await redis.pttl(lockKey)).toBeGreaterThan(0);
    expect(await redis.pttl(lockKey)).toBeLessThanOrEqual(5_000);
  });

  it('allows acquisition after the lease TTL expires', async () => {
    const saleId = nextSaleId();
    const first = await leases.acquireMaintenanceLease({
      saleId,
      ownerToken: randomUUID(),
      ttlMs: 40,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    const second = await leases.acquireMaintenanceLease({
      saleId,
      ownerToken: randomUUID(),
      ttlMs: 5_000,
    });

    expect([first, second]).toEqual([true, true]);
  });

  it('releases only when the owner token matches and preserves competing leases', async () => {
    const saleId = nextSaleId();
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await leases.acquireMaintenanceLease({ saleId, ownerToken: ownerA, ttlMs: 5_000 });

    const wrongRelease = await leases.releaseMaintenanceLease(saleId, ownerB);
    const rightRelease = await leases.releaseMaintenanceLease(saleId, ownerA);
    const repeatRelease = await leases.releaseMaintenanceLease(saleId, ownerA);

    expect([wrongRelease, rightRelease, repeatRelease]).toEqual([false, true, false]);
    expect(await redis.exists(flashSaleMaintenanceLockKey(saleId))).toBe(0);
  });
});
