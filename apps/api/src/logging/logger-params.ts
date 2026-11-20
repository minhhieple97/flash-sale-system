import type { Params } from 'nestjs-pino';
import pino, { type DestinationStream } from 'pino';
import { LOG_DESTINATION_IS_SYNC, LOGGER_ROUTES } from './logging.constants';

export function buildLoggerParams(level: string, stream?: DestinationStream): Params {
  const destination = stream ?? pino.destination({ sync: LOG_DESTINATION_IS_SYNC });
  return { pinoHttp: [{ level, autoLogging: false }, destination], forRoutes: LOGGER_ROUTES };
}
