import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { found, joined, makeRepo, run } from './test-support/fixture.mjs';

const CONTROLLER = 'apps/api/src/modules/orders/controllers/orders.controller.ts';
const SERVICE = 'apps/api/src/modules/orders/services/orders.service.ts';

describe('controller-injection', () => {
  test('flags forbidden imports and injected storage types', () => {
    const body = joined([
      "import { Controller } from '@nestjs/common';",
      "import { Repository } from 'typeorm';",
      "import { Queue } from 'bullmq';",
      'export class C {',
      '  constructor(private readonly repo: OrderRepository) {}',
      '}',
    ]);
    const result = run(makeRepo({ [CONTROLLER]: body }));
    assert.equal(result.status, 1);
    assert.deepEqual(found(result), [
      `${CONTROLLER}:2 [controller-injection]`,
      `${CONTROLLER}:3 [controller-injection]`,
      `${CONTROLLER}:5 [controller-injection]`,
    ]);
  });

  test('flags raw storage type names and storage injection decorators', () => {
    const body = joined([
      'export class C {',
      '  constructor(',
      '    private readonly a: DataSource,',
      '    private readonly b: EntityManager,',
      '    private readonly c: Queue,',
      '    private readonly d: Redis,',
      '    @InjectRepository(Order) private readonly e: Foo,',
      '    @Inject(REDIS_CLIENT) private readonly f: Bar,',
      '    @Inject(ORDERS_SERVICE) private readonly g: Svc,',
      '    private readonly h: OrdersService,',
      '  ) {}',
      '}',
    ]);
    const result = run(makeRepo({ [CONTROLLER]: body }));
    assert.deepEqual(
      found(result).map((entry) => entry.split(':')[1].split(' ')[0]),
      ['3', '4', '5', '6', '7', '8', '8'],
    );
  });

  test('a thin controller injecting a service is clean', () => {
    const body = joined([
      "import { Controller } from '@nestjs/common';",
      'export class C {',
      '  constructor(private readonly orders: OrdersService) {}',
      '}',
    ]);
    assert.equal(run(makeRepo({ [CONTROLLER]: body })).status, 0);
  });
});

describe('service-raw-storage', () => {
  test('flags imports, raw storage calls and SQL literals but allows bullmq', () => {
    const body = joined([
      "import { Queue } from 'bullmq';",
      "import { DataSource } from 'typeorm';",
      "import Redis from 'ioredis';",
      'export class S {',
      "  a(db: Db) { return db.query('x'); }",
      "  b() { return this.redis.hgetall('k'); }",
      '  c() { return `SELECT 1`; }',
      "  d() { return 'DELETE FROM orders'; }",
      "  e() { return 'UPDATE orders SET a = 1'; }",
      "  f() { return 'INSERT INTO orders (a) VALUES (1)'; }",
      `  g() { return \`SELECT \${cols} FROM orders\`; }`,
      "  h() { return 'Select a product from the list'; }",
      "  i() { return this.queue.add('job', {}); }",
      '}',
    ]);
    const result = run(makeRepo({ [SERVICE]: body }));
    assert.equal(result.status, 1);
    assert.deepEqual(found(result), [
      `${SERVICE}:2 [service-raw-storage]`,
      `${SERVICE}:3 [service-raw-storage]`,
      `${SERVICE}:5 [service-raw-storage]`,
      `${SERVICE}:6 [service-raw-storage]`,
      `${SERVICE}:7 [service-raw-storage]`,
      `${SERVICE}:8 [service-raw-storage]`,
      `${SERVICE}:9 [service-raw-storage]`,
      `${SERVICE}:10 [service-raw-storage]`,
      `${SERVICE}:11 [service-raw-storage]`,
    ]);
  });

  test('UI copy such as "Select a product from the list" does not trip SQL detection', () => {
    const body = "export const copy = 'Select a product from the list';\n";
    assert.equal(run(makeRepo({ [SERVICE]: body })).status, 0);
  });

  test('does not apply to repositories', () => {
    const body = "import { DataSource } from 'typeorm';\nexport const q = 'SELECT 1';\n";
    const repo = 'apps/api/src/modules/orders/repositories/orders.repository.ts';
    assert.equal(run(makeRepo({ [repo]: body })).status, 0);
  });
});

describe('service-raw-storage coverage', () => {
  const PROCESSOR = 'apps/api/src/modules/orders/processors/persist.processor.ts';

  test('flags Redis hash, multi-key and custom Lua command calls', () => {
    const methods = 'hgetall hmget hsetnx mget mset attemptPurchase rollbackPurchase'.split(' ');
    const lines = methods.map((m) => `  ${m}_() { return this.redis.${m}('k'); }`);
    const body = joined(['export class S {', ...lines, '}']);
    const result = run(makeRepo({ [SERVICE]: body }));
    assert.deepEqual(
      found(result),
      methods.map((_, i) => `${SERVICE}:${i + 2} [service-raw-storage]`),
    );
  });

  test('ordinary JS method names such as get, set, del, exec and keys stay allowed', () => {
    const body = joined([
      'export class S {',
      '  a(m: Map<string, string>) { return [m.get("a"), m.set("a", "b"), m.delete("a")]; }',
      '  b(re: RegExp) { return [re.exec("a"), Object.keys({})]; }',
      '}',
    ]);
    assert.equal(run(makeRepo({ [SERVICE]: body })).status, 0);
  });

  test('flags any reference to the REDIS_CLIENT token', () => {
    const body = joined([
      "import { REDIS_CLIENT } from '../constants/redis.constants';",
      'export class S {',
      '  constructor(@Inject(REDIS_CLIENT) private readonly redis: FlashSaleRedis) {}',
      '}',
    ]);
    const result = run(makeRepo({ [SERVICE]: body }));
    assert.deepEqual(found(result), [
      `${SERVICE}:1 [redis-client-owner]`,
      `${SERVICE}:1 [service-raw-storage]`,
      `${SERVICE}:3 [redis-client-owner]`,
      `${SERVICE}:3 [service-raw-storage]`,
    ]);
  });

  test('applies to processors as well as services', () => {
    const body = joined([
      "import { DataSource } from 'typeorm';",
      'export class P {',
      "  run() { return this.redis.hgetall('k'); }",
      '}',
    ]);
    const result = run(makeRepo({ [PROCESSOR]: body }));
    assert.deepEqual(found(result), [
      `${PROCESSOR}:1 [service-raw-storage]`,
      `${PROCESSOR}:3 [service-raw-storage]`,
    ]);
  });
});

describe('module-barrel-import', () => {
  const orders = {
    'apps/web/src/modules/orders/index.ts': 'export const a = 1;\n',
    'apps/web/src/modules/orders/hooks/use-x.ts': 'export const useX = 1;\n',
  };
  const PAY = 'apps/web/src/modules/checkout/components/pay.tsx';

  test('other modules may import only the barrel', () => {
    const body = joined([
      "import { a } from '@/modules/orders';",
      "import { b } from '@/modules/orders/index';",
      "import { c } from '@/modules/orders/hooks/use-x';",
      "import { d } from '../../orders/hooks/use-x';",
      "export { e } from '@/modules/orders/api/orders.api';",
      "export const f = () => import('@/modules/orders/hooks/use-x');",
      "import { g } from '../hooks/use-g';",
      "import { h } from 'react';",
      "import { i } from '@/shared/utils/format';",
    ]);
    const result = run(makeRepo({ ...orders, [PAY]: body }));
    assert.equal(result.status, 1);
    assert.deepEqual(
      found(result),
      [3, 4, 5, 6].map((n) => `${PAY}:${n} [module-barrel-import]`),
    );
    assert.match(result.lines[0], /@\/modules\/orders/);
  });

  test('deep imports inside the same module pass', () => {
    const body = joined([
      "import { a } from '../hooks/use-x';",
      "import { b } from '@/modules/orders/hooks/use-x';",
    ]);
    const files = { ...orders, 'apps/web/src/modules/orders/components/list.tsx': body };
    assert.equal(run(makeRepo(files)).status, 0);
  });

  test('app shell code cannot reach into a module either', () => {
    const body = "import { c } from '@/modules/orders/hooks/use-x';\n";
    const result = run(makeRepo({ ...orders, 'apps/web/src/app/root.tsx': body }));
    assert.deepEqual(found(result), ['apps/web/src/app/root.tsx:1 [module-barrel-import]']);
  });
});
