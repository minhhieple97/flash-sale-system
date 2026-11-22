import path from 'node:path';
import { applyExceptions } from './arch-check/exceptions.mjs';
import { collectFiles, findRepoRoot } from './arch-check/files.mjs';
import { RULES } from './arch-check/registry.mjs';

function compare(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function byPathThenLine(a, b) {
  return compare(a.relPath, b.relPath) || a.line - b.line || compare(a.ruleId, b.ruleId);
}

function checkFile(ctx) {
  const raw = RULES.filter((rule) => rule.appliesTo(ctx)).flatMap((rule) => rule.check(ctx));
  return applyExceptions(ctx, raw);
}

function main() {
  const cwd = process.cwd();
  const root = findRepoRoot(cwd);
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args.map((arg) => path.resolve(cwd, arg)) : [cwd];
  const files = collectFiles(targets, root);
  const results = files.map(checkFile);
  const violations = results.flatMap((result) => result.kept).sort(byPathThenLine);
  const honored = results.flatMap((result) => result.honored).sort(byPathThenLine);
  for (const v of violations) console.log(`${v.relPath}:${v.line} [${v.ruleId}] ${v.message}`);
  for (const e of honored)
    console.log(`${e.relPath}:${e.line} [exception ${e.ruleId}] ${e.reason}`);
  if (violations.length === 0) {
    console.log(`arch-check: OK (${files.length} files checked)`);
    return 0;
  }
  const summary = `${violations.length} violations, ${files.length} files checked`;
  console.log(`arch-check: FAILED (${summary})`);
  return 1;
}

process.exitCode = main();
