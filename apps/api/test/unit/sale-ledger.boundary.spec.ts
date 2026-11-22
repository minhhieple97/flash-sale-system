import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { relativeSpecifiers } from '../support/relative-imports';

const SRC_ROOT = resolve(__dirname, '../../src');
const LEDGER_DIR = 'modules/sale-ledger';
const LEDGER_BARRELS = new Set([LEDGER_DIR, `${LEDGER_DIR}/index`]);

interface ResolvedImport {
  file: string;
  target: string;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function relativeImports(): ResolvedImport[] {
  return listSourceFiles(SRC_ROOT).flatMap((path) => {
    const file = relative(SRC_ROOT, path);
    return relativeSpecifiers(readFileSync(path, 'utf8')).map((specifier) => ({
      file,
      target: relative(SRC_ROOT, resolve(dirname(path), specifier)),
    }));
  });
}

const isInside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

const describeImport = ({ file, target }: ResolvedImport): string => `${file} -> ${target}`;

describe('sale-ledger module boundary', () => {
  it('lets no file outside modules/sale-ledger import past its index barrel', () => {
    const imports = relativeImports();

    const deepImports = imports.filter(
      ({ file, target }) =>
        !isInside(file, LEDGER_DIR) && isInside(target, LEDGER_DIR) && !LEDGER_BARRELS.has(target),
    );

    expect(deepImports.map(describeImport)).toEqual([]);
  });

  it('keeps src/infrastructure free of imports from modules/', () => {
    const imports = relativeImports();

    const domainImports = imports.filter(
      ({ file, target }) => isInside(file, 'infrastructure') && isInside(target, 'modules'),
    );

    expect(domainImports.map(describeImport)).toEqual([]);
  });
});
