import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnvFiles } from '../../src/config/load-dotenv.util';

describe('loadDotEnvFiles', () => {
  let rootDir: string;
  let appDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'dotenv-test-'));
    appDir = join(rootDir, 'apps', 'api');
    mkdirSync(appDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('loads .env then ../../.env without overwriting already-set keys', () => {
    writeFileSync(
      join(appDir, '.env'),
      ['APP_ROLE=api', 'LOG_LEVEL=debug', 'LOCAL_ONLY=from-app'].join('\n'),
    );
    writeFileSync(
      join(rootDir, '.env'),
      ['APP_ROLE=worker', 'LOG_LEVEL=warn', 'TRUST_PROXY=true', 'ROOT_ONLY=from-root'].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { APP_ROLE: 'all', EMPTY_PRESET: '' };

    loadDotEnvFiles({ cwd: appDir, env });

    expect(env).toEqual({
      APP_ROLE: 'all',
      EMPTY_PRESET: '',
      LOG_LEVEL: 'debug',
      LOCAL_ONLY: 'from-app',
      TRUST_PROXY: 'true',
      ROOT_ONLY: 'from-root',
    });
  });

  it('handles blank lines, comments, export prefixes, and quoted values', () => {
    writeFileSync(
      join(appDir, '.env'),
      [
        '',
        '  # full line comment',
        'export EXPORTED=yes',
        "SINGLE_QUOTED='hello # world' # trailing comment",
        'DOUBLE_QUOTED="line1\\nline2 \\"quoted\\" # kept" # trailing comment',
        'UNQUOTED_COMMENT=value # inline comment',
        'UNQUOTED_HASH=abc#123',
        'EMPTY_VALUE=',
        'INVALID_LINE_WITHOUT_EQUALS',
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = {};

    loadDotEnvFiles({ cwd: appDir, env });

    expect(env).toEqual({
      EXPORTED: 'yes',
      SINGLE_QUOTED: 'hello # world',
      DOUBLE_QUOTED: 'line1\nline2 "quoted" # kept',
      UNQUOTED_COMMENT: 'value',
      UNQUOTED_HASH: 'abc#123',
      EMPTY_VALUE: '',
    });
  });

  it('silently ignores missing env files', () => {
    const env: NodeJS.ProcessEnv = { EXISTING: '1' };

    expect(() => loadDotEnvFiles({ cwd: appDir, env })).not.toThrow();
    expect(env).toEqual({ EXISTING: '1' });
  });
});
