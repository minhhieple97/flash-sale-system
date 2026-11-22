import { relativeSpecifiers } from '../support/relative-imports';

describe('relativeSpecifiers', () => {
  it.each([
    ['a named import', "import { a } from '../x/a';", '../x/a'],
    ['a type import', "import type { A } from '../x/a';", '../x/a'],
    ['a bare side-effect import', "import '../x/register';", '../x/register'],
    ['a re-export', "export { a } from '../x/a';", '../x/a'],
    ['a star re-export', "export * from '../x/a';", '../x/a'],
    ['a namespace re-export', "export * as ns from '../x/a';", '../x/a'],
    ['a dynamic import', "const a = await import('../x/a');", '../x/a'],
    ['a double-quoted import', 'import { a } from "../x/a";', '../x/a'],
    ['a multi-line import', "import {\n  a,\n  b,\n} from\n  '../x/a';", '../x/a'],
  ])('finds the specifier of %s', (_label, source, expected) => {
    expect(relativeSpecifiers(source)).toEqual([expected]);
  });

  it('ignores package imports', () => {
    expect(relativeSpecifiers("import { a } from 'ioredis';\nimport 'reflect-metadata';")).toEqual(
      [],
    );
  });
});
