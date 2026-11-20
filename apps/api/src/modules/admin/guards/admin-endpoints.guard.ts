import { type CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../../config/env.interface';
import { ADMIN_ENDPOINTS_DISABLED_MESSAGE } from '../constants/admin.constants';

/** Disabled admin routes answer 404, so they look absent rather than forbidden. */
@Injectable()
export class AdminEndpointsGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(): boolean {
    if (!this.config.get('ENABLE_ADMIN_ENDPOINTS', { infer: true })) {
      throw new NotFoundException(ADMIN_ENDPOINTS_DISABLED_MESSAGE);
    }
    return true;
  }
}
