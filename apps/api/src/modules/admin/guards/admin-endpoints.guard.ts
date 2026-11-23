import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  UNAUTHORIZED_ADMIN_MESSAGE,
} from '../../../common/constants/common.constants';
import type { AppEnv } from '../../../config/env.interface';
import {
  ADMIN_ENDPOINTS_DISABLED_MESSAGE,
  UNAUTHENTICATED_ADMIN_PRODUCTION_WARNING,
  UNSUPPORTED_MEDIA_TYPE_CODE,
  UNSUPPORTED_MEDIA_TYPE_MESSAGE,
} from '../constants/admin.constants';

function sha256Digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function keysMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  return timingSafeEqual(sha256Digest(expected), sha256Digest(provided));
}

function isJsonContentType(contentType: unknown): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

function hasConfiguredKey(key: string | undefined): key is string {
  return key !== undefined && key.length > 0;
}

/** Disabled admin routes answer 404, so they look absent rather than forbidden. */
@Injectable()
export class AdminEndpointsGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(AdminEndpointsGuard.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  onModuleInit(): void {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const isEnabled = this.config.get('ENABLE_ADMIN_ENDPOINTS', { infer: true });
    const hasKey = hasConfiguredKey(this.config.get('ADMIN_API_KEY', { infer: true }));
    if (isProd && isEnabled && !hasKey) {
      this.logger.warn(UNAUTHENTICATED_ADMIN_PRODUCTION_WARNING);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get('ENABLE_ADMIN_ENDPOINTS', { infer: true })) {
      throw new NotFoundException(ADMIN_ENDPOINTS_DISABLED_MESSAGE);
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    this.assertAuthorized(request);
    this.assertJsonPost(request);
    return true;
  }

  private assertAuthorized(request: FastifyRequest): void {
    const configuredKey = this.config.get('ADMIN_API_KEY', { infer: true });
    if (!hasConfiguredKey(configuredKey)) return;
    if (!keysMatch(configuredKey, request.headers['x-admin-key'])) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: UNAUTHORIZED_ADMIN_MESSAGE,
      });
    }
  }

  private assertJsonPost(request: FastifyRequest): void {
    if (request.method === 'POST' && !isJsonContentType(request.headers['content-type'])) {
      throw new UnsupportedMediaTypeException({
        code: UNSUPPORTED_MEDIA_TYPE_CODE,
        message: UNSUPPORTED_MEDIA_TYPE_MESSAGE,
      });
    }
  }
}
