import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_FILE_PATHS } from './config.constants';

export interface LoadDotEnvOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  paths?: readonly string[];
}

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function unescapeDoubleQuoted(raw: string): string {
  return raw.replace(/\\([nrt"\\])/g, (match, code: string) => DOUBLE_QUOTE_ESCAPES[code] ?? match);
}

function findClosingDoubleQuote(raw: string): number {
  let escaped = false;
  for (let i = 1; i < raw.length; i += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (raw[i] === '\\') {
      escaped = true;
      continue;
    }
    if (raw[i] === '"') return i;
  }
  return -1;
}

function parseQuotedValue(raw: string): string {
  const quote = raw[0];
  const closingIndex = quote === '"' ? findClosingDoubleQuote(raw) : raw.indexOf("'", 1);
  if (closingIndex === -1) return raw.slice(1);
  const inner = raw.slice(1, closingIndex);
  return quote === '"' ? unescapeDoubleQuoted(inner) : inner;
}

function parseValue(raw: string): string {
  const trimmedStart = raw.trimStart();
  if (trimmedStart.startsWith('"') || trimmedStart.startsWith("'")) {
    return parseQuotedValue(trimmedStart);
  }
  const commentIndex = trimmedStart.search(/(?:^|\s)#/);
  const unquoted = commentIndex === -1 ? trimmedStart : trimmedStart.slice(0, commentIndex);
  return unquoted.trim();
}

function parseEnvLine(line: string): readonly [string, string] | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return undefined;
  const withoutExport = trimmed.replace(/^export\s+/, '');
  const equalsIndex = withoutExport.indexOf('=');
  if (equalsIndex <= 0) return undefined;
  const key = withoutExport.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
  return [key, parseValue(withoutExport.slice(equalsIndex + 1))];
}

function loadSingleFile(filePath: string, env: NodeJS.ProcessEnv): void {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry === undefined) continue;
    const [key, value] = entry;
    if (env[key] === undefined) env[key] = value;
  }
}

export function loadDotEnvFiles(options: LoadDotEnvOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const paths = options.paths ?? ENV_FILE_PATHS;
  for (const relPath of paths) {
    loadSingleFile(resolve(cwd, relPath), env);
  }
}
