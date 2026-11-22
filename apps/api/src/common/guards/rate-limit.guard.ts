import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../../config/env.interface';
import { ERROR_CODES, RATE_LIMITED_MESSAGE } from '../constants/common.constants';
import { RateLimitService } from '../services/rate-limit.service';

function bucketKey(request: FastifyRequest): string {
  const route = request.routeOptions?.url ?? request.url ?? 'unknown';
  return `${request.method}:${route}:${request.ip ?? 'unknown'}`;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly rateLimitService: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get('RATE_LIMIT_ENABLED', { infer: true })) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const decision = this.rateLimitService.consume(bucketKey(request));
    reply.header('X-RateLimit-Limit', String(decision.limit));
    if (decision.allowed) {
      reply.header('X-RateLimit-Remaining', String(decision.remaining));
      return true;
    }
    reply.header('X-RateLimit-Remaining', '0');
    reply.header('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException(
      { code: ERROR_CODES.RATE_LIMITED, message: RATE_LIMITED_MESSAGE },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
