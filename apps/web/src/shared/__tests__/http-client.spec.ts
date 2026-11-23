import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch, textResponse } from '../../test-support/fetch-stub';
import { FALLBACK_ERROR_MESSAGE, NETWORK_ERROR_CODE, requestJson } from '../api/http-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('returns the parsed body of a 2xx response and calls the /api/v1 path', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, { hello: 'world' }));

    const result = await requestJson<{ hello: string }>({ path: '/ping' });

    expect(result).toEqual({ ok: true, status: 200, data: { hello: 'world' } });
    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/ping');
    expect(fetchStub.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('sends a JSON body with a JSON content type on POST', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(202, { ok: 1 }));

    await requestJson({ path: '/buy', method: 'POST', body: { userId: 'u1' } });

    const init = fetchStub.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"userId":"u1"}');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('omits the body when none is given', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, {}));

    await requestJson({ path: '/ping' });

    expect(fetchStub.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it('passes the abort signal through to fetch', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, {}));
    const controller = new AbortController();

    await requestJson({ path: '/ping', signal: controller.signal });

    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('passes through the API error body of a non-2xx response with its status', async () => {
    stubFetch(async () =>
      jsonResponse(409, { code: 'ALREADY_PURCHASED', message: 'Already bought' }),
    );

    const result = await requestJson({ path: '/buy', method: 'POST', body: {} });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: { code: 'ALREADY_PURCHASED', message: 'Already bought' },
    });
  });

  it('maps a non-JSON error body to an HTTP_<status> code and the fallback message', async () => {
    stubFetch(async () => textResponse(502, '<html>Bad Gateway</html>'));

    const result = await requestJson({ path: '/ping' });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: { code: 'HTTP_502', message: FALLBACK_ERROR_MESSAGE },
    });
  });

  it('maps a JSON error body without code and message to the fallback error', async () => {
    stubFetch(async () => jsonResponse(500, { statusCode: 500 }));

    const result = await requestJson({ path: '/ping' });

    expect(result).toMatchObject({ ok: false, status: 500, error: { code: 'HTTP_500' } });
  });

  it('returns INVALID_RESPONSE when a 2xx response has a non-JSON or empty body', async () => {
    stubFetch(async () => textResponse(200, '<html>index</html>'));

    const htmlResult = await requestJson({ path: '/ping' });

    expect(htmlResult).toEqual({
      ok: false,
      status: 200,
      error: { code: 'INVALID_RESPONSE', message: FALLBACK_ERROR_MESSAGE },
    });

    stubFetch(async () => new Response('', { status: 200 }));
    const emptyResult = await requestJson({ path: '/ping' });

    expect(emptyResult).toEqual({
      ok: false,
      status: 200,
      error: { code: 'INVALID_RESPONSE', message: FALLBACK_ERROR_MESSAGE },
    });
  });

  it('merges custom headers with Content-Type on JSON POST and forwards them on GET', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, { ok: true }));

    await requestJson({
      path: '/admin/reset',
      method: 'POST',
      body: { stock: 10 },
      headers: { 'x-admin-key': 'secret-1' },
    });
    await requestJson({ path: '/ping', headers: { 'x-trace': 'abc' } });

    const postHeaders = new Headers(fetchStub.mock.calls[0]?.[1]?.headers);
    expect(postHeaders.get('Content-Type')).toBe('application/json');
    expect(postHeaders.get('x-admin-key')).toBe('secret-1');
    const getHeaders = new Headers(fetchStub.mock.calls[1]?.[1]?.headers);
    expect(getHeaders.get('x-trace')).toBe('abc');
    expect(getHeaders.get('Content-Type')).toBeNull();
  });

  it('returns a status 0 NETWORK_ERROR result when fetch rejects', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await requestJson({ path: '/ping' });

    expect(result).toMatchObject({ ok: false, status: 0, error: { code: NETWORK_ERROR_CODE } });
  });
});
