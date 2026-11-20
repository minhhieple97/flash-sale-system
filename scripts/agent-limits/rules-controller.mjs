import ts from 'typescript';
import { collect, moduleRefs, startLine } from './ast.mjs';

const FORBIDDEN_PACKAGES = ['typeorm', '@nestjs/typeorm', 'ioredis', 'bullmq', '@nestjs/bullmq'];
const STORAGE_TYPE = /\b\w*Repository\b|\bDataSource\b|\bEntityManager\b|\bQueue\b|\bRedis\b/;
const STORAGE_DECORATORS = new Set([
  'InjectRepository',
  'InjectDataSource',
  'InjectEntityManager',
  'InjectQueue',
  'InjectRedis',
]);
const STORAGE_TOKEN = /REDIS|QUEUE|DATA_SOURCE/i;

export function matchesPackage(specifier, packages) {
  return packages.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

function decoratorHead(decorator) {
  const { expression } = decorator;
  if (ts.isIdentifier(expression)) return { name: expression.text, args: [] };
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    return { name: expression.expression.text, args: expression.arguments };
  }
  return { name: '', args: [] };
}

function isStorageDecorator(decorator) {
  const { name, args } = decoratorHead(decorator);
  if (STORAGE_DECORATORS.has(name)) return true;
  return name === 'Inject' && args.length > 0 && STORAGE_TOKEN.test(args[0].getText());
}

function storageReason(param) {
  if (param.type && STORAGE_TYPE.test(param.type.getText())) return `type ${param.type.getText()}`;
  const decorators = ts.canHaveDecorators(param) ? (ts.getDecorators(param) ?? []) : [];
  return decorators.some(isStorageDecorator) ? 'a storage injection decorator' : undefined;
}

function injectionViolations(ctx) {
  return collect(ctx.sourceFile, (node) => {
    if (!ts.isParameter(node) || !ts.isConstructorDeclaration(node.parent)) return undefined;
    const reason = storageReason(node);
    if (!reason) return undefined;
    const message = `controller injects storage via ${reason}; inject a service instead`;
    return {
      relPath: ctx.relPath,
      line: startLine(ctx.sourceFile, node),
      ruleId: 'controller-injection',
      message,
    };
  });
}

function importViolations(ctx) {
  return moduleRefs(ctx.sourceFile)
    .filter((ref) => matchesPackage(ref.specifier, FORBIDDEN_PACKAGES))
    .map((ref) => ({
      relPath: ctx.relPath,
      line: ref.line,
      ruleId: 'controller-injection',
      message: `controllers must not import '${ref.specifier}'; delegate to a service`,
    }));
}

export const controllerRules = [
  {
    id: 'controller-injection',
    appliesTo: (ctx) => /^apps\/api\/.*\.controller\.ts$/.test(ctx.relPath),
    check: (ctx) => [...importViolations(ctx), ...injectionViolations(ctx)],
  },
];
