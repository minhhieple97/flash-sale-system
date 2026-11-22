import { type Mock, vi } from 'vitest';

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

export function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): Mock {
  const stub = vi.fn(impl);
  vi.stubGlobal('fetch', stub);
  return stub;
}
