import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import { exceptions, found, joined, makeRepo, numbered, run } from './test-support/fixture.mjs';

const MARKER = '// agent-limits-allow';

describe('cli scope', () => {
  test('clean fixture exits 0 and prints the OK line', () => {
    const root = makeRepo({ 'apps/api/src/a.ts': 'export const a = 1;\n' });
    const result = run(root);
    assert.equal(result.status, 0);
    assert.deepEqual(result.lines, ['verify-agent-limits: OK (1 files checked)']);
  });

  test('scanning from a subdirectory limits the scan to it', () => {
    const root = makeRepo({
      'apps/api/src/big.ts': numbered(221),
      'apps/web/src/ok.ts': 'export const a = 1;\n',
    });
    const web = run(path.join(root, 'apps/web'));
    assert.equal(web.status, 0);
    assert.match(web.lines.at(-1), /OK \(1 files checked\)/);
    const api = run(path.join(root, 'apps/api'));
    assert.equal(api.status, 0);
    assert.deepEqual(found(api), ['apps/api/src/big.ts:1 [max-file-lines]']);
  });

  test('path arguments are resolved from cwd', () => {
    const root = makeRepo({
      'apps/api/src/big.ts': numbered(221),
      'apps/web/src/ok.ts': 'export const a = 1;\n',
    });
    assert.equal(run(root, ['apps/web']).status, 0);
    assert.equal(run(root, ['apps/api']).status, 0);
  });

  test('architecture violations still fail when size warnings are present', () => {
    const root = makeRepo({
      'apps/api/src/a.ts': numbered(221),
      'apps/api/src/b.ts': 'export const b = forwardRef(() => B);\n',
    });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.lines[0], /warning:/);
    assert.match(result.lines[1], /no-forward-ref/);
    assert.match(result.lines.at(-1), /1 violations?, 1 warnings?/);
  });

  test('node_modules, dist, coverage and declaration files are never scanned', () => {
    const root = makeRepo({
      'apps/api/src/ok.ts': 'export const a = 1;\n',
      'apps/api/src/node_modules/pkg/index.ts': numbered(300),
      'apps/api/node_modules/pkg/src/y.ts': numbered(300),
      'apps/api/src/dist/out.ts': numbered(300),
      'apps/api/src/coverage/c.ts': numbered(300),
      'apps/api/src/types.d.ts': numbered(300),
      'apps/api/other/big.ts': numbered(300),
    });
    const result = run(root);
    assert.equal(result.status, 0);
    assert.deepEqual(result.lines, ['verify-agent-limits: OK (1 files checked)']);
  });

  test('size warnings are sorted by path then line and summarized', () => {
    const root = makeRepo({
      'apps/api/src/b.ts': numbered(221),
      'apps/api/src/a.ts': joined([
        'export const a = (p: number, q: number, r: number, s: number) => 1;',
        'export const b = (p: number, q: number, r: number, s: number) => 1;',
      ]),
    });
    const result = run(root);
    assert.equal(result.status, 0);
    assert.match(result.lines.at(-1), /3 warnings/);
    assert.ok(result.lines.slice(0, 3).every((line) => line.includes('warning:')));
    assert.deepEqual(found(result), [
      'apps/api/src/a.ts:1 [max-params]',
      'apps/api/src/a.ts:2 [max-params]',
      'apps/api/src/b.ts:1 [max-file-lines]',
    ]);
  });
});

describe('justified exceptions', () => {
  test('a file-level marker anywhere suppresses max-file-lines and is printed', () => {
    const body = `${MARKER} max-file-lines: generated lookup table\n${numbered(220)}`;
    const root = makeRepo({ 'apps/api/src/big.ts': body });
    const result = run(root);
    assert.equal(result.status, 0);
    assert.deepEqual(exceptions(result), [
      'apps/api/src/big.ts:1 [exception max-file-lines] generated lookup table',
    ]);
    assert.match(result.lines.at(-1), /OK/);
  });

  test('a function marker on the line directly above suppresses max-function-lines', () => {
    const filler = Array.from({ length: 39 }, () => '  void 0;');
    const body = joined([
      `${MARKER} max-function-lines: flat table`,
      'export function f() {',
      ...filler,
      '}',
    ]);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.equal(result.status, 0);
    assert.deepEqual(exceptions(result), [
      'apps/api/src/a.ts:1 [exception max-function-lines] flat table',
    ]);
  });

  test('a function marker with a blank line before the function suppresses nothing', () => {
    const filler = Array.from({ length: 39 }, () => '  void 0;');
    const body = joined([
      `${MARKER} max-function-lines: flat table`,
      '',
      'export function f() {',
      ...filler,
      '}',
    ]);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.equal(result.status, 0);
    assert.deepEqual(found(result), ['apps/api/src/a.ts:3 [max-function-lines]']);
  });

  test('a params marker on the line above suppresses max-params', () => {
    const body = joined([
      `${MARKER} max-params: wire format`,
      'export function f(a: 1, b: 2, c: 3, d: 4) {}',
    ]);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.equal(result.status, 0);
    assert.equal(exceptions(result).length, 1);
  });

  test('an empty reason is an invalid-exception and suppresses nothing', () => {
    const body = `${MARKER} max-file-lines:\n${numbered(220)}`;
    const result = run(makeRepo({ 'apps/api/src/big.ts': body }));
    assert.equal(result.status, 1);
    assert.deepEqual(found(result), [
      'apps/api/src/big.ts:1 [invalid-exception]',
      'apps/api/src/big.ts:1 [max-file-lines]',
    ]);
  });

  test('a marker naming a non-size rule is an invalid-exception and suppresses nothing', () => {
    const body = joined([
      "import { forwardRef } from '@nestjs/common';",
      `${MARKER} no-forward-ref: cycle`,
      'export const a = forwardRef(() => B);',
    ]);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.equal(result.status, 1);
    assert.deepEqual(found(result), [
      'apps/api/src/a.ts:2 [invalid-exception]',
      'apps/api/src/a.ts:3 [no-forward-ref]',
    ]);
    assert.deepEqual(exceptions(result), []);
  });

  test('marker text inside a string literal is not a marker', () => {
    const body = joined([`export const s = \`\n${MARKER} max-file-lines:\n\`;`]);
    const result = run(makeRepo({ 'apps/api/src/a.ts': body }));
    assert.equal(result.status, 0);
  });
});
