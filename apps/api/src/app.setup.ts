import { HttpAdapterHost } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  API_GLOBAL_PREFIX,
  HEALTH_ROUTE,
  METRICS_ROUTE,
} from './common/constants/common.constants';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'no-referrer'],
];

export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: [HEALTH_ROUTE, METRICS_ROUTE] });
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost)));
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (_request, reply, payload) => {
      for (const [name, value] of SECURITY_HEADERS) {
        reply.header(name, value);
      }
      return payload;
    });
  app.enableShutdownHooks();
}
