import { RequestMethod } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';

export const LOG_DESTINATION_IS_SYNC = false;
export const LOGGER_ROUTES: string[] = ['{*path}'];
/**
 * pino-http serializes the request into a child logger on every call, which costs a large share of
 * CPU per request on these routes. Their warn and error lines are still written, only without request context.
 */
export const LOGGER_EXCLUDED_HOT_ROUTES: RouteInfo[] = [
  { path: 'checkout/purchase', method: RequestMethod.POST },
  { path: 'flash-sales/current', method: RequestMethod.GET },
  { path: 'orders/user/:userId', method: RequestMethod.GET },
  { path: 'products/featured', method: RequestMethod.GET },
];
