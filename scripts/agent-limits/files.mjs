import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const DECLARATION = /\.d\.(ts|mts|cts)$/;
const IN_SCOPE = /^(apps\/[^/]+\/(src|test)|scripts)\//;
const TEST_NAME = /\.(spec|e2e-spec|test)\./;

export function findRepoRoot(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

function* walk(target) {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isFile()) {
    yield target;
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

export function isTestPath(relPath) {
  return (
    TEST_NAME.test(path.posix.basename(relPath)) ||
    relPath.includes('/__tests__/') ||
    /^apps\/[^/]+\/test\//.test(relPath)
  );
}

function scriptKind(relPath) {
  if (relPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  return /\.(js|mjs|cjs)$/.test(relPath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function toContext(abs, root) {
  const relPath = path.relative(root, abs).split(path.sep).join('/');
  if (!IN_SCOPE.test(relPath) || !SOURCE_EXT.test(relPath) || DECLARATION.test(relPath)) {
    return undefined;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const sourceFile = ts.createSourceFile(
    relPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(relPath),
  );
  return { relPath, kind: isTestPath(relPath) ? 'test' : 'source', text, sourceFile };
}

export function collectFiles(targets, root) {
  const seen = new Map();
  for (const target of targets) {
    for (const abs of walk(target)) {
      if (seen.has(abs)) continue;
      seen.set(abs, toContext(abs, root));
    }
  }
  return [...seen.values()].filter(Boolean);
}
