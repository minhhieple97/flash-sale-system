import { BadRequestException } from '@nestjs/common';
import {
  ERROR_CODES,
  INVALID_USER_ID_MESSAGE,
  USER_ID_MAX_LENGTH,
} from '../../src/common/constants/common.constants';
import { NormalizedUserIdPipe } from '../../src/common/pipes/normalized-user-id.pipe';

function captureResponse(pipe: NormalizedUserIdPipe, value: unknown): unknown {
  try {
    pipe.transform(value);
  } catch (error) {
    if (error instanceof BadRequestException) return error.getResponse();
    throw error;
  }
  throw new Error('expected the pipe to throw BadRequestException');
}

describe('NormalizedUserIdPipe', () => {
  const pipe = new NormalizedUserIdPipe();

  it('trims and lowercases a valid user id', () => {
    const raw = '  ALICE@Example.com ';

    const userId = pipe.transform(raw);

    expect(userId).toBe('alice@example.com');
  });

  it.each([
    ['an illegal character', 'a!'],
    ['a too short id', 'ab'],
    ['a too long id', 'a'.repeat(USER_ID_MAX_LENGTH + 1)],
    ['undefined', undefined],
    ['a number', 42],
  ])('rejects %s with INVALID_USER_ID', (_name, value) => {
    const response = captureResponse(pipe, value);

    expect(response).toEqual({
      code: ERROR_CODES.INVALID_USER_ID,
      message: INVALID_USER_ID_MESSAGE,
    });
  });
});
