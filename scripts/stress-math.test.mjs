import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildRequestHeaders } from '../tests/stress/http-client.mjs';
import { storeChecks } from '../tests/stress/invariants.mjs';
import {
  PURCHASE_PATH,
  RESET_PATH,
  resetBody,
  SCENARIOS,
  selectScenarios,
} from '../tests/stress/scenarios.mjs';
import {
  barrierVerdict,
  isMidRun,
  mergeThresholds,
  midRunThroughput,
  rateOver,
} from '../tests/stress/stress-math.mjs';

describe('rateOver', () => {
  test('counts the intervals between samples, not the samples', () => {
    assert.equal(rateOver(101, 1000, 2000), 100);
  });

  test('is NaN when the window has no width', () => {
    assert.ok(Number.isNaN(rateOver(5, 1000, 1000)));
  });
});

describe('midRunThroughput', () => {
  test('ignores a slow first 10% and a slow last 10%', () => {
    const fast = Array.from({ length: 80 }, (_, i) => 1000 + i * 10);
    const slowHead = Array.from({ length: 10 }, (_, i) => i * 100);
    const slowTail = Array.from({ length: 10 }, (_, i) => 2000 + i * 100);
    const completions = [...slowHead, ...fast, ...slowTail];
    assert.equal(Math.round(midRunThroughput(completions)), 100);
  });

  test('does not depend on the order the completions arrive in', () => {
    const completions = Array.from({ length: 100 }, (_, i) => i * 10);
    assert.equal(midRunThroughput([...completions].reverse()), midRunThroughput(completions));
  });
});

describe('isMidRun', () => {
  test('keeps iterations 10 to 89 of 100 and drops the rest', () => {
    const kept = Array.from({ length: 100 }, (_, i) => i).filter((i) => isMidRun(i, 100));
    assert.deepEqual([kept[0], kept.at(-1), kept.length], [10, 89, 80]);
  });
});

describe('barrierVerdict', () => {
  test('fails below 95% of the VUs', () => {
    const verdict = barrierVerdict(237, 250);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.minimum, 238);
  });

  test('passes at exactly 95% rounded up', () => {
    assert.equal(barrierVerdict(238, 250).ok, true);
  });
});

describe('mergeThresholds', () => {
  test('concatenates the rules of a metric both sides define', () => {
    const merged = mergeThresholds({ a: ['x'], b: ['y'] }, { a: ['z'], c: ['w'] });
    assert.deepEqual(merged, { a: ['x', 'z'], b: ['y'], c: ['w'] });
  });
});

describe('selectScenarios', () => {
  const all = {
    one: { name: 'one', isDefault: true },
    two: { name: 'two', isDefault: false },
  };

  test('runs only the default scenarios when no name is given', () => {
    assert.deepEqual(
      selectScenarios(all, []).map((s) => s.name),
      ['one'],
    );
  });

  test('includes pg-blip and the four defaults only when no name is given', () => {
    const names = selectScenarios(SCENARIOS, []).map((s) => s.name);

    assert.deepEqual(names, ['oversell', 'same-user-race', 'mixed', 'pg-blip']);
  });

  test('runs realistic-mix only when explicitly selected', () => {
    const selected = selectScenarios(SCENARIOS, ['realistic-mix']);

    assert.equal(selected.length, 1);
    assert.equal(selected[0].name, 'realistic-mix');
    assert.equal(selected[0].isDefault, false);
  });

  test('runs an opt-in scenario when it is named', () => {
    assert.deepEqual(
      selectScenarios(all, ['two']).map((s) => s.name),
      ['two'],
    );
  });

  test('names the known scenarios when a name is unknown', () => {
    assert.throws(() => selectScenarios(all, ['nope']), /unknown scenario "nope".*one, two/);
  });
});

describe('storeChecks horizon', () => {
  const snap = {
    orderIds: [],
    orderUserIds: [],
    remainingStock: 0,
    totalStock: 0,
    redisStock: 0,
    userEntries: [],
  };
  const scenario = { totalStock: 0, expected: {}, confirmHorizonMs: 30000 };

  test('fails naming the horizon when a 202 never became CONFIRMED', () => {
    const checks = storeChecks({
      scenario,
      result: { reservedOrderIds: [] },
      stillPending: 3,
      snap,
    });
    const [drained] = checks;
    assert.equal(drained.label, 'every 202 became CONFIRMED within 30s');
    assert.equal(drained.ok, false);
    assert.equal(drained.detail, '3 pending');
  });
});

describe('resetBody', () => {
  test('opens the sale now for an hour so a configured SALE_* window cannot apply', () => {
    assert.deepEqual(resetBody({ totalStock: 100 }), {
      totalStock: 100,
      startsOffsetSeconds: 0,
      durationSeconds: 3600,
    });
  });

  test('carries every scenario stock', () => {
    for (const scenario of Object.values(SCENARIOS)) {
      assert.equal(resetBody(scenario).totalStock, scenario.totalStock);
    }
  });
});

describe('buildRequestHeaders', () => {
  test('sends x-admin-key only on reset calls when ADMIN_API_KEY is non-empty', () => {
    const previous = process.env.ADMIN_API_KEY;
    try {
      process.env.ADMIN_API_KEY = 'secret-key';
      assert.equal(buildRequestHeaders(RESET_PATH, '{}')['x-admin-key'], 'secret-key');
      assert.equal(buildRequestHeaders(PURCHASE_PATH, '{}')['x-admin-key'], undefined);

      process.env.ADMIN_API_KEY = '';
      assert.equal(buildRequestHeaders(RESET_PATH, '{}')['x-admin-key'], undefined);

      delete process.env.ADMIN_API_KEY;
      assert.equal(buildRequestHeaders(RESET_PATH, '{}')['x-admin-key'], undefined);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previous;
    }
  });
});
