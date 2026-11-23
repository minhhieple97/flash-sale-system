import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ENV_FILE_PATHS } from './config.constants';

export function loadDotEnvFiles(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  paths: readonly string[] = ENV_FILE_PATHS,
): void {
  for (const relPath of paths) {
    const filePath = resolve(cwd, relPath);
    if (!existsSync(filePath)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(filePath, 'utf8')))) {
      if (env[key] === undefined && value !== undefined) env[key] = value;
    }
  }
}
