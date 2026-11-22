import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const COMPOSE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../docker-compose.yml');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const composeService = (verb) =>
  execFileAsync('docker', ['compose', '-f', COMPOSE_FILE, verb, 'postgres']);

export async function withPostgresOutage(outageMs, work) {
  if (!outageMs) return work();
  await composeService('stop');
  const restarted = sleep(outageMs).then(() => composeService('start'));
  try {
    return await work();
  } finally {
    await restarted;
  }
}
