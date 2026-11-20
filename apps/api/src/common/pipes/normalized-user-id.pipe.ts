import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { NormalizedUserId } from '../interfaces/user-id.interface';
import { normalizeUserId } from '../utils/user-id-normalizer.util';

/** The only place an HTTP user id becomes a NormalizedUserId. */
@Injectable()
export class NormalizedUserIdPipe implements PipeTransform<unknown, NormalizedUserId> {
  transform(value: unknown): NormalizedUserId {
    const normalization = normalizeUserId(value);
    if (!normalization.isValid) throw new BadRequestException(normalization.error);
    return normalization.userId;
  }
}
