import { buildService } from '../support/reset-service.fixture';

const INPUT = { totalStock: 5, startsOffsetSeconds: -60, durationSeconds: 3600 };

describe('FlashSaleResetService pending reset', () => {
  it('runs a reset whose ledger replace failed again with the same plan, then clears it', async () => {
    const { service, rescheduleCampaign, replaceState } = buildService();
    replaceState.mockRejectedValueOnce(new Error('redis blip'));
    await expect(service.reset(INPUT)).rejects.toThrow('redis blip');

    const retried = await service.completePendingReset();
    const afterwards = await service.completePendingReset();

    expect([retried, afterwards]).toEqual(['COMPLETED', 'NONE']);
    expect(rescheduleCampaign).toHaveBeenCalledTimes(2);
    expect(rescheduleCampaign.mock.calls[1]).toEqual(rescheduleCampaign.mock.calls[0]);
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it('keeps the plan while the retry fails, and completes it on a later call', async () => {
    const { service, replaceState } = buildService();
    replaceState.mockRejectedValueOnce(new Error('redis blip'));
    replaceState.mockRejectedValueOnce(new Error('redis still down'));
    await expect(service.reset(INPUT)).rejects.toThrow('redis blip');

    await expect(service.completePendingReset()).rejects.toThrow('redis still down');
    const retried = await service.completePendingReset();

    expect(retried).toBe('COMPLETED');
    expect(replaceState).toHaveBeenCalledTimes(3);
  });

  it('keeps nothing to retry when the PostgreSQL step failed, since the old sale is intact', async () => {
    const { service, rescheduleCampaign, replaceState } = buildService();
    rescheduleCampaign.mockRejectedValueOnce(new Error('pg blip'));
    await expect(service.reset(INPUT)).rejects.toThrow('pg blip');

    const outcome = await service.completePendingReset();

    expect(outcome).toBe('NONE');
    expect(rescheduleCampaign).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('drops a pending reset once a newer reset succeeds', async () => {
    const { service, replaceState } = buildService();
    replaceState.mockRejectedValueOnce(new Error('redis blip'));
    await expect(service.reset(INPUT)).rejects.toThrow('redis blip');
    await service.reset({ totalStock: 3 });

    const outcome = await service.completePendingReset();

    expect(outcome).toBe('NONE');
    expect(replaceState).toHaveBeenCalledTimes(2);
  });
});
