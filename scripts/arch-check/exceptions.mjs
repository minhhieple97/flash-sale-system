import ts from 'typescript';
import { lineOf } from './ast.mjs';

const MARKER = /^\/\/\s*arch-check-allow\b\s*([^\s:]*)\s*:?\s*(.*)$/;
const SCOPE = { 'max-file-lines': 'file', 'max-function-lines': 'line', 'max-params': 'line' };

function isJsDoc(node) {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

function lineComments(sourceFile) {
  const seen = new Map();
  const onLeaf = (node) => {
    ts.forEachLeadingCommentRange(sourceFile.text, node.pos, (pos, end, kind) => {
      if (kind === ts.SyntaxKind.SingleLineCommentTrivia)
        seen.set(pos, sourceFile.text.slice(pos, end));
    });
  };
  const walk = (node) => {
    if (isJsDoc(node)) return;
    const children = node.getChildren(sourceFile);
    if (children.length === 0) onLeaf(node);
    for (const child of children) walk(child);
  };
  walk(sourceFile);
  return [...seen].map(([pos, text]) => ({ line: lineOf(sourceFile, pos), text }));
}

export function parseMarkers(ctx) {
  const markers = [];
  for (const { line, text } of lineComments(ctx.sourceFile)) {
    const match = MARKER.exec(text.trim());
    if (!match) continue;
    const [, ruleId, reason] = match;
    markers.push({
      line,
      ruleId,
      reason: reason.trim(),
      valid: ruleId in SCOPE && reason.trim() !== '',
    });
  }
  return markers;
}

function covers(marker, violation) {
  if (marker.ruleId !== violation.ruleId) return false;
  return SCOPE[marker.ruleId] === 'file' || marker.line === violation.line - 1;
}

export function applyExceptions(ctx, violations) {
  const markers = parseMarkers(ctx).filter((marker) => marker.valid);
  const kept = [];
  const honored = new Map();
  for (const violation of violations) {
    const marker = markers.find((candidate) => covers(candidate, violation));
    if (marker) honored.set(marker, { relPath: ctx.relPath, ...marker });
    else kept.push(violation);
  }
  return { kept, honored: [...honored.values()] };
}

export const invalidExceptionRule = {
  id: 'invalid-exception',
  appliesTo: () => true,
  check(ctx) {
    return parseMarkers(ctx)
      .filter((marker) => !marker.valid)
      .map((marker) => ({
        relPath: ctx.relPath,
        line: marker.line,
        ruleId: 'invalid-exception',
        message: `arch-check-allow needs a size rule id (${Object.keys(SCOPE).join(', ')}) and a non-empty reason`,
      }));
  },
};
