import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_GLOBAL_PREFIX } from './common/constants/common.constants';

export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableShutdownHooks();
}
