import path from 'node:path';
import { moduleRefs } from './ast.mjs';

const WEB_SRC = 'apps/web/src';
const MODULE_PATH = /^apps\/web\/src\/modules\/([^/]+)(?:\/(.*))?$/;
const BARREL_FILE = /^index(\.\w+)?$/;

function resolveSpecifier(specifier, importer) {
  if (specifier.startsWith('@/')) return `${WEB_SRC}/${specifier.slice(2)}`;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return path.posix.join(path.posix.dirname(importer), specifier);
  }
  return undefined;
}

function barrelViolation(importer, specifier) {
  const target = resolveSpecifier(specifier, importer);
  const hit = target && MODULE_PATH.exec(path.posix.normalize(target));
  if (!hit) return undefined;
  const [, moduleName, rest = ''] = hit;
  if (rest === '' || BARREL_FILE.test(rest)) return undefined;
  if (MODULE_PATH.exec(importer)?.[1] === moduleName) return undefined;
  return `import the public barrel '@/modules/${moduleName}' instead of '${specifier}'`;
}

export const webRules = [
  {
    id: 'module-barrel-import',
    appliesTo: (ctx) => ctx.relPath.startsWith(`${WEB_SRC}/`),
    check: (ctx) =>
      moduleRefs(ctx.sourceFile).flatMap((ref) => {
        const message = barrelViolation(ctx.relPath, ref.specifier);
        if (!message) return [];
        return [{ relPath: ctx.relPath, line: ref.line, ruleId: 'module-barrel-import', message }];
      }),
  },
];
