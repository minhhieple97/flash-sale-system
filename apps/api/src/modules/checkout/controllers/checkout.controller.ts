import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitGuard } from '../../../common/guards/rate-limit.guard';
import type { NormalizedUserId } from '../../../common/interfaces/user-id.interface';
import { NormalizedUserIdPipe } from '../../../common/pipes/normalized-user-id.pipe';
import {
  CHECKOUT_ROUTE,
  PURCHASE_HTTP_STATUS,
  PURCHASE_ROUTE,
  PURCHASE_USER_ID_FIELD,
} from '../constants/checkout.constants';
import {
  type PurchaseAttemptResponseDto,
  toPurchaseAttemptResponse,
} from '../dto/purchase-attempt.response.dto';
import { CheckoutService } from '../services/checkout.service';

@Controller(CHECKOUT_ROUTE)
@UseGuards(RateLimitGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post(PURCHASE_ROUTE)
  async purchase(
    @Body(PURCHASE_USER_ID_FIELD, NormalizedUserIdPipe) userId: NormalizedUserId,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PurchaseAttemptResponseDto> {
    const result = await this.checkoutService.attemptPurchase(userId, request.id);
    reply.status(PURCHASE_HTTP_STATUS[result.outcome]);
    return toPurchaseAttemptResponse(result);
  }
}
