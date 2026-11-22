import path from 'node:path';
import ts from 'typescript';
import { collect, moduleRefs, startLine } from './ast.mjs';

const WEB_SRC = 'apps/web/src';
const MODULE_PATH = /^apps\/web\/src\/modules\/([^/]+)(?:\/(.*))?$/;
const BARREL_FILE = /^index(\.\w+)?$/;
const WEB_CONSTANTS = /^apps\/web\/src\/(?:.+\/)?constants\/[^/]+\.ts$/;

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

function isStringKeyword(node) {
  return node?.kind === ts.SyntaxKind.StringKeyword;
}

function isStringKeyedMap(node) {
  if (ts.isIndexSignatureDeclaration(node)) return isStringKeyword(node.parameters[0]?.type);
  const isRecord = ts.isTypeReferenceNode(node) && node.typeName.getText() === 'Record';
  return isRecord && isStringKeyword(node.typeArguments?.[0]);
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
  {
    id: 'web-string-keyed-record',
    appliesTo: (ctx) => WEB_CONSTANTS.test(ctx.relPath),
    check: (ctx) =>
      collect(ctx.sourceFile, (node) => {
        if (!isStringKeyedMap(node)) return undefined;
        return {
          relPath: ctx.relPath,
          line: startLine(ctx.sourceFile, node),
          ruleId: 'web-string-keyed-record',
          message:
            'a string-keyed map hides a missing key behind a fallback; key it by a union and write `satisfies Record<Union, ...>`',
        };
      }),
  },
];
