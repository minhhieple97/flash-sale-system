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
      ['DOTENV_TEST_PRESET=from-app', 'DOTENV_TEST_LOCAL=from-app'].join('\n'),
    );
    writeFileSync(
      join(rootDir, '.env'),
      ['DOTENV_TEST_LOCAL=from-root', 'DOTENV_TEST_ROOT=from-root'].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { DOTENV_TEST_PRESET: 'preset' };

    loadDotEnvFiles(appDir, env);

    expect(env).toEqual({
      DOTENV_TEST_PRESET: 'preset',
      DOTENV_TEST_LOCAL: 'from-app',
      DOTENV_TEST_ROOT: 'from-root',
    });
  });

  it('silently ignores missing env files', () => {
    const env: NodeJS.ProcessEnv = { EXISTING: '1' };

    expect(() => loadDotEnvFiles(appDir, env)).not.toThrow();
    expect(env).toEqual({ EXISTING: '1' });
  });
});
