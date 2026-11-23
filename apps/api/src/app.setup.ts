import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  API_GLOBAL_PREFIX,
  HEALTH_ROUTE,
  HTTP_BODY_LIMIT_BYTES,
  HTTP_MAX_PARAM_LENGTH,
  METRICS_ROUTE,
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
} from './common/constants/common.constants';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { MetricsService } from './modules/metrics/services/metrics.service';

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'no-referrer'],
];
const REQUEST_ID_HEADER_LOWER = REQUEST_ID_HEADER.toLowerCase();
const METRICS_ROUTE_PATH = `/${METRICS_ROUTE}`;
const NANOSECONDS_PER_SECOND = 1e9;

function resolveRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER_LOWER];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();
}

function resolveMetricsService(app: NestFastifyApplication): MetricsService | null {
  try {
    return app.get(MetricsService, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

function registerHttpLatencyHooks(app: NestFastifyApplication, metrics: MetricsService): void {
  const instance = app.getHttpAdapter().getInstance();
  const startedAtByRequest = new WeakMap<object, bigint>();
  instance.addHook('onRequest', (request, _reply, done) => {
    startedAtByRequest.set(request, process.hrtime.bigint());
    done();
  });
  instance.addHook('onResponse', (request, reply, done) => {
    const startedAt = startedAtByRequest.get(request);
    const route = request.routeOptions?.url;
    if (startedAt !== undefined && route !== METRICS_ROUTE_PATH) {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_SECOND;
      metrics.recordHttpRequestDuration({
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationSeconds,
      });
    }
    done();
  });
}

export function createFastifyAdapter(trustProxy = false): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: HTTP_BODY_LIMIT_BYTES,
    trustProxy,
    routerOptions: { maxParamLength: HTTP_MAX_PARAM_LENGTH },
    genReqId: resolveRequestId,
  });
}

export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: [HEALTH_ROUTE, METRICS_ROUTE] });
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost)));
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, ...[payload, done]) => {
      for (const [name, value] of SECURITY_HEADERS) {
        reply.header(name, value);
      }
      reply.header(REQUEST_ID_HEADER, request.id);
      done(null, payload);
    });
  const metrics = resolveMetricsService(app);
  if (metrics !== null) {
    registerHttpLatencyHooks(app, metrics);
  }
  app.enableShutdownHooks();
}
