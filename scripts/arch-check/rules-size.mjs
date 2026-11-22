import ts from 'typescript';
import { collect, endLine, isFunctionLike, startLine } from './ast.mjs';

const FILE_LIMIT = { source: 220, test: 250 };
const MAX_FUNCTION_LINES = 40;
const MAX_PARAMS = 3;
const reporter = (ruleId) => (ctx, line, message) => ({
  relPath: ctx.relPath,
  line,
  ruleId,
  message,
});
const fileLines = reporter('max-file-lines');
const functionLines = reporter('max-function-lines');
const params = reporter('max-params');
const noForwardRef = reporter('no-forward-ref');

function physicalLines(text) {
  if (text === '') return 0;
  const count = text.split('\n').length;
  return text.endsWith('\n') ? count - 1 : count;
}

function isThisParam(param) {
  return ts.isIdentifier(param.name) && param.name.text === 'this';
}

function isForwardRefCallee(expression) {
  if (ts.isIdentifier(expression)) return expression.text === 'forwardRef';
  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'forwardRef';
}

export const sizeRules = [
  {
    id: 'max-file-lines',
    appliesTo: () => true,
    check(ctx) {
      const limit = FILE_LIMIT[ctx.kind];
      const lines = physicalLines(ctx.text);
      if (lines <= limit) return [];
      return [fileLines(ctx, 1, `${lines} lines exceeds the ${ctx.kind} limit of ${limit}`)];
    },
  },
  {
    id: 'max-function-lines',
    appliesTo: (ctx) => ctx.kind === 'source',
    check: (ctx) =>
      collect(ctx.sourceFile, (node) => {
        if (!isFunctionLike(node)) return undefined;
        const start = startLine(ctx.sourceFile, node);
        const length = endLine(ctx.sourceFile, node) - start + 1;
        if (length <= MAX_FUNCTION_LINES) return undefined;
        return functionLines(ctx, start, `${length} lines exceeds ${MAX_FUNCTION_LINES}`);
      }),
  },
  {
    id: 'max-params',
    appliesTo: () => true,
    check: (ctx) =>
      collect(ctx.sourceFile, (node) => {
        if (!isFunctionLike(node) || ts.isConstructorDeclaration(node)) return undefined;
        const count = node.parameters.filter((param) => !isThisParam(param)).length;
        if (count <= MAX_PARAMS) return undefined;
        const line = startLine(ctx.sourceFile, node);
        return params(ctx, line, `${count} parameters exceeds ${MAX_PARAMS}; use a params object`);
      }),
  },
  {
    id: 'no-forward-ref',
    appliesTo: () => true,
    check: (ctx) =>
      collect(ctx.sourceFile, (node) => {
        if (!ts.isCallExpression(node) || !isForwardRefCallee(node.expression)) return undefined;
        const line = startLine(ctx.sourceFile, node);
        return noForwardRef(ctx, line, 'forwardRef() is forbidden; extract the shared contract');
      }),
  },
];
