import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'verify-agent-limits.mjs',
);

const created = [];
process.on('exit', () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

export function makeRepo(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-limits-')));
  created.push(root);
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

export function run(cwd, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], { cwd, encoding: 'utf8' });
  const lines = result.stdout.split('\n').filter(Boolean);
  return { status: result.status, lines, stderr: result.stderr };
}

export function found(result) {
  return result.lines.map((line) => /^\S+:\d+ \[[a-z-]+\]/.exec(line)?.[0]).filter(Boolean);
}

export function exceptions(result) {
  return result.lines.filter((line) => /^\S+:\d+ \[exception /.test(line));
}

export function numbered(count) {
  return Array.from({ length: count }, (_, i) => `export const v${i} = ${i};`)
    .join('\n')
    .concat('\n');
}

export function functionOf(lineCount) {
  const filler = Array.from({ length: lineCount - 2 }, () => '  void 0;');
  return ['export function f(): void {', ...filler, '}', ''].join('\n');
}

export function joined(lines) {
  return `${lines.join('\n')}\n`;
}
