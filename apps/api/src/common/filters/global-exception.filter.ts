import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import {
  ERROR_CODES,
  INTERNAL_ERROR_MESSAGE,
  VALIDATION_MESSAGE_SEPARATOR,
} from '../constants/common.constants';
import type { ApiError } from '../interfaces/api-error.interface';

interface MappedError {
  status: number;
  body: ApiError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function messageOf(response: unknown, fallback: string): string {
  if (typeof response === 'string') return response;
  if (!isRecord(response)) return fallback;
  const { message } = response;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(VALIDATION_MESSAGE_SEPARATOR);
  return fallback;
}

function mapHttpException(exception: HttpException): MappedError {
  const status = exception.getStatus();
  const response = exception.getResponse();
  const message = messageOf(response, exception.message);
  if (isRecord(response) && typeof response.code === 'string') {
    return { status, body: { code: response.code, message } };
  }
  return { status, body: { code: HttpStatus[status] ?? ERROR_CODES.INTERNAL_ERROR, message } };
}

export function mapException(exception: unknown): MappedError {
  if (exception instanceof HttpException) return mapHttpException(exception);
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: ERROR_CODES.INTERNAL_ERROR, message: INTERNAL_ERROR_MESSAGE },
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = mapException(exception);
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), body, status);
  }
}
