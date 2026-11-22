import path from 'node:path';
import ts from 'typescript';
import { collect, moduleRefs, startLine } from './ast.mjs';

const INFRASTRUCTURE = 'apps/api/src/infrastructure/';
const MODULES = 'apps/api/src/modules/';
const REDIS_TOKEN = 'REDIS_CLIENT';
const REDIS_OWNER_DIRS = [
  'apps/api/src/infrastructure/redis/',
  'apps/api/src/modules/sale-ledger/',
];
const REDIS_OWNER_FILES = new Set([
  'apps/api/src/modules/health/repositories/health-cache.repository.ts',
]);

function resolvesUnderModules(importer, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return `${target}/`.startsWith(MODULES);
}

function isRedisOwner(relPath) {
  return REDIS_OWNER_FILES.has(relPath) || REDIS_OWNER_DIRS.some((dir) => relPath.startsWith(dir));
}

export const apiBoundaryRules = [
  {
    id: 'infrastructure-imports-modules',
    appliesTo: (ctx) => ctx.relPath.startsWith(INFRASTRUCTURE),
    check: (ctx) =>
      moduleRefs(ctx.sourceFile)
        .filter((ref) => resolvesUnderModules(ctx.relPath, ref.specifier))
        .map((ref) => ({
          relPath: ctx.relPath,
          line: ref.line,
          ruleId: 'infrastructure-imports-modules',
          message: `infrastructure must not import '${ref.specifier}'; move the shared type into apps/api/src/infrastructure, or into the owning module's barrel and import infrastructure from there`,
        })),
  },
  {
    id: 'redis-client-owner',
    appliesTo: (ctx) =>
      ctx.kind === 'source' && ctx.relPath.startsWith('apps/api/') && !isRedisOwner(ctx.relPath),
    check: (ctx) =>
      collect(ctx.sourceFile, (node) => {
        if (!ts.isIdentifier(node) || node.text !== REDIS_TOKEN) return undefined;
        return {
          relPath: ctx.relPath,
          line: startLine(ctx.sourceFile, node),
          ruleId: 'redis-client-owner',
          message: `${REDIS_TOKEN} belongs to infrastructure/redis, sale-ledger and HealthCacheRepository; read and write sale state through SaleLedgerRepository from modules/sale-ledger`,
        };
      }),
  },
];
