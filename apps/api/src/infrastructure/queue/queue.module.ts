import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.interface';
import { redisConnectionOptions } from '../redis/redis-connection.options';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        connection: redisConnectionOptions(config),
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
