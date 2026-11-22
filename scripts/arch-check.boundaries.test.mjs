import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { found, joined, makeRepo, run } from './test-support/fixture.mjs';

describe('infrastructure-imports-modules', () => {
  const CODEC = 'apps/api/src/infrastructure/redis/flash-sale-config.codec.ts';

  test('flags static, re-export and dynamic imports that resolve under apps/api/src/modules', () => {
    const body = joined([
      "import type { FlashSaleSnapshot } from '../../modules/flash-sales/interfaces/flash-sale.interface';",
      "export { SaleLedgerRepository } from '../../modules/sale-ledger';",
      "export const load = () => import('../../modules/orders/orders.module');",
    ]);
    const result = run(makeRepo({ [CODEC]: body }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      found(result),
      [1, 2, 3].map((n) => `${CODEC}:${n} [infrastructure-imports-modules]`),
    );
    assert.match(result.lines[0], /move the shared type into apps\/api\/src\/infrastructure/);
  });

  test('imports inside infrastructure, packages and module-to-infrastructure imports pass', () => {
    const files = {
      [CODEC]: joined([
        "import Redis from 'ioredis';",
        "import { REDIS_CLIENT } from './redis.constants';",
        "import { DB } from '../database/database.module';",
      ]),
      'apps/api/src/modules/orders/orders.module.ts':
        "import { RedisModule } from '../../infrastructure/redis/redis.module';\n",
    };
    assert.equal(run(makeRepo(files)).status, 0);
  });
});

describe('redis-client-owner', () => {
  const REPO = 'apps/api/src/modules/orders/repositories/order-cache.repository.ts';
  const inject = joined([
    "import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.constants';",
    'export class R {',
    '  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}',
    '}',
  ]);

  test('flags REDIS_CLIENT in a repository outside the owners and names SaleLedgerRepository', () => {
    const result = run(makeRepo({ [REPO]: inject }));
    assert.equal(result.status, 1);
    assert.deepEqual(found(result), [
      `${REPO}:1 [redis-client-owner]`,
      `${REPO}:3 [redis-client-owner]`,
    ]);
    assert.match(result.lines[0], /SaleLedgerRepository/);
  });

  test('the redis infrastructure, the sale-ledger module and HealthCacheRepository may use it', () => {
    const files = {
      'apps/api/src/infrastructure/redis/redis.module.ts': inject,
      'apps/api/src/modules/sale-ledger/sale-ledger.module.ts': inject,
      'apps/api/src/modules/health/repositories/health-cache.repository.ts': inject,
    };
    assert.equal(run(makeRepo(files)).status, 0);
  });

  test('other health files and test files are judged by path', () => {
    const health = 'apps/api/src/modules/health/repositories/other.repository.ts';
    const files = {
      [health]: inject,
      'apps/api/src/modules/orders/repositories/order-cache.repository.spec.ts': inject,
      'apps/api/test/support/redis.ts': inject,
    };
    assert.deepEqual(found(run(makeRepo(files))), [
      `${health}:1 [redis-client-owner]`,
      `${health}:3 [redis-client-owner]`,
    ]);
  });
});

describe('web-string-keyed-record', () => {
  const CONSTANTS = 'apps/web/src/modules/checkout/constants/checkout.constants.ts';

  test('flags Record<string, ...> and string index signatures in web constants', () => {
    const body = joined([
      'export const A: Readonly<Record<string, Feedback>> = {};',
      'export const B: { [key: string]: Feedback } = {};',
      'export interface C { [code: string]: string }',
    ]);
    const result = run(makeRepo({ [CONSTANTS]: body }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      found(result),
      [1, 2, 3].map((n) => `${CONSTANTS}:${n} [web-string-keyed-record]`),
    );
    assert.match(result.lines[0], /satisfies Record<Union, \.\.\.>/);
  });

  test('union-keyed records, Map<string, ...> and string records outside constants pass', () => {
    const files = {
      [CONSTANTS]: joined([
        'export const A = {} satisfies Record<PurchaseCode, Feedback>;',
        'export const B: Readonly<Record<SaleState, string>> = {};',
        'export const C = new Map<string, number>();',
      ]),
      'apps/web/src/shared/api/http-client.ts':
        'export const d = (v: unknown) => v as Record<string, unknown>;\n',
    };
    assert.equal(run(makeRepo(files)).status, 0);
  });
});
