import { ServiceUnavailableException } from '@nestjs/common';
import { ERROR_CODES, TEMPORARY_FAILURE_MESSAGE } from '../constants/common.constants';

export const temporaryFailure = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: ERROR_CODES.TEMPORARY_FAILURE,
    message: TEMPORARY_FAILURE_MESSAGE,
  });
