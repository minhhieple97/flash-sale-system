import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { App } from '../App';
import { ACTIVE_SALE } from './app-fixtures';

const renders = vi.hoisted(() => ({ product: vi.fn() }));

vi.mock('@/modules/product', () => ({
  ProductShowcaseCard: () => {
    renders.product();
    return null;
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  renders.product.mockClear();
});

it('does not rerender the product when polling updates the sale status', async () => {
  vi.useFakeTimers();
  const fetchStub = stubFetch(async () => jsonResponse(200, ACTIVE_SALE));
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const productRenders = renders.product.mock.calls.length;

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });

  expect(fetchStub).toHaveBeenCalledTimes(2);
  expect(renders.product).toHaveBeenCalledTimes(productRenders);
});
