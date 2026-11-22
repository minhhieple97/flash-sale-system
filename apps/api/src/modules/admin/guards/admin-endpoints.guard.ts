import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  UNAUTHORIZED_ADMIN_MESSAGE,
} from '../../../common/constants/common.constants';
import type { AppEnv } from '../../../config/env.interface';
import { ADMIN_ENDPOINTS_DISABLED_MESSAGE } from '../constants/admin.constants';

function keysMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.byteLength !== providedBuf.byteLength) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Disabled admin routes answer 404, so they look absent rather than forbidden. */
@Injectable()
export class AdminEndpointsGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get('ENABLE_ADMIN_ENDPOINTS', { infer: true })) {
      throw new NotFoundException(ADMIN_ENDPOINTS_DISABLED_MESSAGE);
    }
    const configuredKey = this.config.get('ADMIN_API_KEY', { infer: true });
    if (configuredKey === undefined || configuredKey.length === 0) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!keysMatch(configuredKey, request.headers['x-admin-key'])) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: UNAUTHORIZED_ADMIN_MESSAGE,
      });
    }
    return true;
  }
}
