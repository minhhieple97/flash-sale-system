import ts from 'typescript';

export function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

export function collect(sourceFile, pick) {
  const out = [];
  visit(sourceFile, (node) => {
    const value = pick(node);
    if (value) out.push(value);
  });
  return out;
}

export function lineOf(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

export function startLine(sourceFile, node) {
  return lineOf(sourceFile, node.getStart(sourceFile));
}

export function endLine(sourceFile, node) {
  return lineOf(sourceFile, node.end);
}

export function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function moduleRefOf(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  const isDynamic =
    ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
  return isDynamic ? node.arguments[0] : undefined;
}

export function moduleRefs(sourceFile) {
  return collect(sourceFile, (node) => {
    const spec = moduleRefOf(node);
    if (!spec || !ts.isStringLiteralLike(spec)) return undefined;
    return { specifier: spec.text, line: startLine(sourceFile, spec) };
  });
}
