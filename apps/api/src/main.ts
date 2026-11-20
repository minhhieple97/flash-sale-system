import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { DEFAULT_HTTP_PORT, HTTP_LISTEN_HOST } from './common/constants/common.constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  configureApp(app);
  await app.listen(Number(process.env.PORT ?? DEFAULT_HTTP_PORT), HTTP_LISTEN_HOST);
}

void bootstrap();
