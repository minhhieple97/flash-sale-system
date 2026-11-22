import http from 'node:http';
import { ORDER_LOOKUP_PATH, RESET_PATH } from './scenarios.mjs';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// At 250 in flight, fetch's client-side queueing lands in the latency this runner reports.
// Same server, p95 380-690ms with fetch versus 125-259ms with node:http.
const agent = new http.Agent({ keepAlive: true });

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

export function buildRequestHeaders(path, payload) {
  const headers = payload
    ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
    : {};
  const adminKey = process.env.ADMIN_API_KEY;
  if (path === RESET_PATH && adminKey) headers['x-admin-key'] = adminKey;
  return headers;
}

export function request(method, path, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = buildRequestHeaders(path, payload);
  return new Promise((settle, fail) => {
    const req = http.request(`${BASE_URL}${path}`, { method, agent, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        settle({ status: res.statusCode, body: parseJson(Buffer.concat(chunks)) }),
      );
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end(payload);
  });
}

export const postJson = (path, body) => request('POST', path, body);

export async function orderStatus(userId) {
  const { body } = await request('GET', `${ORDER_LOOKUP_PATH}/${encodeURIComponent(userId)}`);
  return body?.status ?? 'UNKNOWN';
}

export async function assertHealthy() {
  const res = await request('GET', '/health').catch(() => null);
  if (res?.status !== 200) {
    throw new Error(`GET ${BASE_URL}/health returned ${res?.status ?? 'no response'}`);
  }
}

export const closeClient = () => agent.destroy();
