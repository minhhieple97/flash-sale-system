import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { found, functionOf, joined, makeRepo, numbered, run } from './test-support/fixture.mjs';

const filler = (count) => Array.from({ length: count }, () => '  void 0;');

describe('max-file-lines', () => {
  test('source files pass at 220 lines and warn at 221', () => {
    assert.equal(run(makeRepo({ 'apps/api/src/a.ts': numbered(220) })).status, 0);
    const result = run(makeRepo({ 'apps/api/src/a.ts': numbered(221) }));
    assert.equal(result.status, 0);
    assert.deepEqual(found(result), ['apps/api/src/a.ts:1 [max-file-lines]']);
  });

  test('a missing trailing newline does not change the count', () => {
    const text = numbered(220).trimEnd();
    assert.equal(run(makeRepo({ 'apps/api/src/a.ts': text })).status, 0);
  });

  test('test files pass at 250 lines and warn at 251', () => {
    const spec = 'apps/api/src/a.spec.ts';
    assert.equal(run(makeRepo({ [spec]: numbered(250) })).status, 0);
    assert.deepEqual(found(run(makeRepo({ [spec]: numbered(251) }))), [
      `${spec}:1 [max-file-lines]`,
    ]);
  });

  test('files under __tests__ and apps/*/test count as tests', () => {
    const files = {
      'apps/web/src/modules/x/__tests__/b.ts': numbered(250),
      'apps/api/test/c.ts': numbered(250),
    };
    assert.equal(run(makeRepo(files)).status, 0);
    const over = { 'apps/api/test/c.ts': numbered(251) };
    assert.deepEqual(found(run(makeRepo(over))), ['apps/api/test/c.ts:1 [max-file-lines]']);
  });

  test('scripts/** is in scope', () => {
    const result = run(makeRepo({ 'scripts/tool.mjs': numbered(221) }));
    assert.deepEqual(found(result), ['scripts/tool.mjs:1 [max-file-lines]']);
  });
});

describe('max-function-lines', () => {
  test('a 40-line function passes and a 41-line function warns', () => {
    assert.equal(run(makeRepo({ 'apps/api/src/a.ts': functionOf(40) })).status, 0);
    const result = run(makeRepo({ 'apps/api/src/a.ts': functionOf(41) }));
    assert.equal(result.status, 0);
    assert.match(result.lines[0], /warning:/);
    assert.deepEqual(found(result), ['apps/api/src/a.ts:1 [max-function-lines]']);
  });

  test('a long method is reported at its start line', () => {
    const body = joined(['export class A {', '  m(): void {', ...filler(39), '  }', '}']);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.deepEqual(found(result), ['apps/api/src/a.ts:2 [max-function-lines]']);
  });

  test('a long arrow function is flagged', () => {
    const body = joined(['export const g = (): void => {', ...filler(39), '};']);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.deepEqual(found(result), ['apps/api/src/a.ts:1 [max-function-lines]']);
  });

  test('a 41-line describe callback in a spec passes but not in source', () => {
    const body = joined(["describe('x', () => {", ...filler(39), '});']);
    assert.equal(run(makeRepo({ 'apps/api/src/a.spec.ts': body })).status, 0);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.deepEqual(found(result), ['apps/api/src/a.ts:1 [max-function-lines]']);
  });
});

describe('max-params', () => {
  test('three parameters pass and four warn', () => {
    const three = 'export function f(a: 1, b: 2, c: 3) {}\n';
    assert.equal(run(makeRepo({ 'apps/api/src/a.ts': three })).status, 0);
    const four = 'export function f(a: 1, b: 2, c: 3, d: 4) {}\n';
    const result = run(makeRepo({ 'apps/api/src/a.ts': four }));
    assert.equal(result.status, 0);
    assert.match(result.lines[0], /warning:/);
    assert.deepEqual(found(result), ['apps/api/src/a.ts:1 [max-params]']);
  });

  test('a this parameter is not counted', () => {
    const body = 'export function f(this: Foo, a: 1, b: 2, c: 3) {}\n';
    assert.equal(run(makeRepo({ 'apps/api/src/a.ts': body })).status, 0);
  });

  test('a constructor with five parameters passes', () => {
    const body = 'export class A {\n  constructor(a: X, b: X, c: X, d: X, e: X) {}\n}\n';
    assert.equal(run(makeRepo({ 'apps/api/src/a.ts': body })).status, 0);
  });

  test('applies to test files too', () => {
    const body = 'export const g = (a: 1, b: 2, c: 3, d: 4) => a;\n';
    const result = run(makeRepo({ 'apps/api/src/a.spec.ts': body }));
    assert.deepEqual(found(result), ['apps/api/src/a.spec.ts:1 [max-params]']);
  });
});

describe('no-forward-ref', () => {
  test('flags bare and member forwardRef calls but not the import', () => {
    const body = joined([
      "import { forwardRef } from '@nestjs/common';",
      'export const a = forwardRef(() => B);',
      'export const b = nest.forwardRef(() => B);',
    ]);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.deepEqual(found(result), [
      'apps/api/src/a.ts:2 [no-forward-ref]',
      'apps/api/src/a.ts:3 [no-forward-ref]',
    ]);
  });

  test('flags forwardRef in test files', () => {
    const result = run(
      makeRepo({ 'apps/api/test/a.ts': 'export const a = forwardRef(() => B);\n' }),
    );
    assert.deepEqual(found(result), ['apps/api/test/a.ts:1 [no-forward-ref]']);
  });
});
