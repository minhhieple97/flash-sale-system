import path from 'node:path';
import { applyExceptions } from './agent-limits/exceptions.mjs';
import { collectFiles, findRepoRoot } from './agent-limits/files.mjs';
import { RULES } from './agent-limits/registry.mjs';

const WARNING_RULES = new Set(['max-file-lines', 'max-function-lines', 'max-params']);

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
  for (const v of violations) {
    const level = WARNING_RULES.has(v.ruleId) ? 'warning: ' : '';
    console.log(`${v.relPath}:${v.line} [${v.ruleId}] ${level}${v.message}`);
  }
  for (const e of honored)
    console.log(`${e.relPath}:${e.line} [exception ${e.ruleId}] ${e.reason}`);
  const warnings = violations.filter((v) => WARNING_RULES.has(v.ruleId)).length;
  const errors = violations.length - warnings;
  if (errors === 0) {
    const warningSummary = warnings ? `, ${warnings} warnings` : '';
    console.log(`verify-agent-limits: OK (${files.length} files checked${warningSummary})`);
    return 0;
  }
  const summary = `${errors} violations, ${warnings} warnings, ${files.length} files checked`;
  console.log(`verify-agent-limits: FAILED (${summary})`);
  return 1;
}

process.exitCode = main();
