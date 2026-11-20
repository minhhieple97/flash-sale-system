import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { HTTP_LISTEN_HOST } from './common/constants/common.constants';
import type { AppEnv } from './config/env.interface';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const port: number = config.get('PORT', { infer: true });
  await app.listen(port, HTTP_LISTEN_HOST);
}

void bootstrap();
