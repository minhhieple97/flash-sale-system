import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppEnv } from '../config/env.interface';
import { buildLoggerParams } from './logger-params';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const level: string = config.get('LOG_LEVEL', { infer: true });
        return buildLoggerParams(level);
      },
    }),
  ],
})
export class LoggingModule {}
