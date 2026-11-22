import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT_ENV_FILE = path.resolve(__dirname, '../../../../.env');
const DEFAULT_REDIS_PORT = 6379;

if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

function portOf(target: unknown): number {
  if (typeof target === 'object' && target !== null && 'port' in target) {
    return Number(target.port);
  }
  return Number(target);
}

// A Redis or BullMQ client built without connection options falls back to localhost:6379. On hosts
// where REDIS_PORT points elsewhere, 6379 belongs to some other program, and a test must never
// write there.
function refuseDefaultRedisPort(
  original: typeof net.createConnection,
): typeof net.createConnection {
  return ((...args: unknown[]) => {
    const isConfigured = process.env.REDIS_PORT === String(DEFAULT_REDIS_PORT);
    if (portOf(args[0]) === DEFAULT_REDIS_PORT && !isConfigured) {
      throw new Error(
        `refusing to connect to the default Redis port ${DEFAULT_REDIS_PORT}; REDIS_PORT is ${process.env.REDIS_PORT}. A client is missing its connection config.`,
      );
    }
    return Reflect.apply(original, net, args);
  }) as typeof net.createConnection;
}

net.createConnection = refuseDefaultRedisPort(net.createConnection);
net.connect = net.createConnection;
