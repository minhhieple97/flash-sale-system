import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { stockKey, usersKey } from './store-keys.mjs';

const execFileAsync = promisify(execFile);
const COMPOSE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../docker-compose.yml');
const PSQL = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F "|" -c "$1"';

async function compose(...args) {
  const { stdout } = await execFileAsync('docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    'exec',
    '-T',
    ...args,
  ]);
  return stdout.trim();
}

const psql = (sql) => compose('postgres', 'sh', '-c', PSQL, 'sh', sql);
const redis = (...cmd) => compose('redis', 'redis-cli', '--raw', ...cmd);

export async function snapshotStores(saleId) {
  const [sale, orderRows, stock, users] = await Promise.all([
    psql(`SELECT total_stock, remaining_stock FROM flash_sales WHERE id = '${saleId}'`),
    psql(`SELECT id, user_id FROM orders WHERE flash_sale_id = '${saleId}'`),
    redis('GET', stockKey(saleId)),
    redis('HVALS', usersKey(saleId)),
  ]);
  const [totalStock, remainingStock] = sale.split('|').map(Number);
  const orders = orderRows ? orderRows.split('\n').map((row) => row.split('|')) : [];
  return {
    totalStock,
    remainingStock,
    orderIds: orders.map(([id]) => id),
    orderUserIds: orders.map(([, userId]) => userId),
    redisStock: Number(stock),
    userEntries: users ? users.split('\n') : [],
  };
}
