/**
 * Wire shape of POST /api/v1/checkout/purchase. The controller binds PURCHASE_USER_ID_FIELD
 * through NormalizedUserIdPipe, which validates and brands the value; class-validator cannot
 * produce a NormalizedUserId, so this class only names the field.
 */
export class PurchaseAttemptRequestDto {
  userId!: string;
}
