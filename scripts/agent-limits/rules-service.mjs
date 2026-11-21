import ts from 'typescript';
import { collect, moduleRefs, startLine } from './ast.mjs';
import { matchesPackage } from './rules-controller.mjs';

const FORBIDDEN_PACKAGES = ['typeorm', '@nestjs/typeorm', 'ioredis'];
const RAW_STORAGE_METHODS = new Set(
  (
    'query createQueryBuilder eval evalsha hget hset hdel hexists hgetall hmget hsetnx mget mset hincrby incr incrby ' +
    'decr decrby setex psetex expire pexpire ping pipeline multi sadd srem smembers zadd attemptPurchase rollbackPurchase'
  ).split(' '),
);
const REDIS_TOKEN = 'REDIS_CLIENT';
const SQL_SHAPE = new RegExp(
  [
    String.raw`\bSELECT\s+(?:\d+\b|\*|[\s\S]+?\sFROM\s)`,
    String.raw`\bINSERT\s+INTO\s`,
    String.raw`\bUPDATE\s+\S+\s+SET\s`,
    String.raw`\bDELETE\s+FROM\s`,
  ].join('|'),
);

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return undefined;
  return node.head.text + node.templateSpans.map((span) => `$${span.literal.text}`).join('');
}

function make(ctx, line, message) {
  return { relPath: ctx.relPath, line, ruleId: 'service-raw-storage', message };
}

function importViolations(ctx) {
  return moduleRefs(ctx.sourceFile)
    .filter((ref) => matchesPackage(ref.specifier, FORBIDDEN_PACKAGES))
    .map((ref) =>
      make(ctx, ref.line, `services must not import '${ref.specifier}'; use a repository`),
    );
}

function callViolations(ctx) {
  return collect(ctx.sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return undefined;
    }
    const method = node.expression.name.text;
    if (!RAW_STORAGE_METHODS.has(method)) return undefined;
    const message = `raw storage call .${method}(); move it to a repository`;
    return make(ctx, startLine(ctx.sourceFile, node), message);
  });
}

function tokenViolations(ctx) {
  return collect(ctx.sourceFile, (node) => {
    if (!ts.isIdentifier(node) || node.text !== REDIS_TOKEN) return undefined;
    const message = `${REDIS_TOKEN} must not be referenced here; use a cache repository`;
    return make(ctx, startLine(ctx.sourceFile, node), message);
  });
}

function sqlViolations(ctx) {
  return collect(ctx.sourceFile, (node) => {
    const text = literalText(node);
    if (text === undefined || !SQL_SHAPE.test(text)) return undefined;
    return make(
      ctx,
      startLine(ctx.sourceFile, node),
      'SQL literal in a service; move it to a repository',
    );
  });
}

export const serviceRules = [
  {
    id: 'service-raw-storage',
    appliesTo: (ctx) => /^apps\/api\/.*\.(service|processor)\.ts$/.test(ctx.relPath),
    check: (ctx) => [
      ...importViolations(ctx),
      ...callViolations(ctx),
      ...tokenViolations(ctx),
      ...sqlViolations(ctx),
    ],
  },
];
