import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ENV_FILE_PATHS } from './config.constants';
import { validateEnv } from './env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ENV_FILE_PATHS,
    }),
  ],
})
export class AppConfigModule {}
