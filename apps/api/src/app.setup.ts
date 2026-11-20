import { HttpAdapterHost } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_GLOBAL_PREFIX, HEALTH_ROUTE } from './common/constants/common.constants';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: [HEALTH_ROUTE] });
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();
}
