import { ClockService } from '../../src/common/providers/clock.service';

describe('ClockService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the current system time in epoch milliseconds', () => {
    const instant = 1_700_000_000_123;
    jest.useFakeTimers().setSystemTime(instant);

    const now = new ClockService().nowMs();

    expect(now).toBe(instant);
  });
});
