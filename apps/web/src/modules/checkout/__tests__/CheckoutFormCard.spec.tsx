import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaleState } from '@/modules/flash-sale';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { CheckoutFormCard } from '../components/CheckoutFormCard';
import {
  ORDER_ID,
  OUTCOME_CASES,
  PURCHASE_URL,
  reservedResponse,
  SALE_SERVER_TIME,
  saleWithState,
  stubCheckoutFlow,
} from './checkout-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function buyNow(): HTMLElement {
  return screen.getByRole('button', { name: 'Buy Now' });
}

function userIdInput(): HTMLInputElement {
  return screen.getByLabelText('User ID (username or email)') as HTMLInputElement;
}

async function buyActive(userId = 'alice'): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<CheckoutFormCard sale={saleWithState('ACTIVE')} />);
  await user.type(userIdInput(), userId);
  await user.click(buyNow());
  return user;
}

describe('CheckoutFormCard availability', () => {
  it.each<[SaleState | null, string]>([
    ['UPCOMING', 'The sale has not started yet.'],
    ['SOLD_OUT', 'This sale is sold out.'],
    ['ENDED', 'This sale has ended.'],
    [null, 'Waiting for the sale status...'],
  ])(
    'disables Buy Now and shows the reason when the sale state is %s',
    async (saleState, reason) => {
      const user = userEvent.setup();
      render(<CheckoutFormCard sale={saleState === null ? null : saleWithState(saleState)} />);

      await user.type(userIdInput(), 'alice');

      expect(buyNow()).toBeDisabled();
      expect(screen.getByText(reason)).toBeInTheDocument();
    },
  );

  it('enables Buy Now for an active sale with a user id and shows no reason', async () => {
    const user = userEvent.setup();
    render(<CheckoutFormCard sale={saleWithState('ACTIVE')} />);
    await user.type(userIdInput(), 'alice');
    expect(buyNow()).toBeEnabled();
    expect(screen.queryByText(/sale has not started yet\.|sold out\.|has ended\./)).toBeNull();
  });

  it('enables Buy Now when the countdown passes startsAt without a new poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(Date.parse(SALE_SERVER_TIME) + 3_600_000);
    render(<CheckoutFormCard sale={saleWithState('UPCOMING')} />);
    fireEvent.change(userIdInput(), { target: { value: 'alice' } });
    expect(buyNow()).toBeDisabled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(buyNow()).toBeEnabled();
    expect(screen.queryByText('The sale has not started yet.')).toBeNull();
  });

  it('disables Buy Now for a blank user id', async () => {
    const user = userEvent.setup();
    render(<CheckoutFormCard sale={saleWithState('ACTIVE')} />);
    await user.type(userIdInput(), '   ');
    expect(buyNow()).toBeDisabled();
  });

  it('exposes the card as a Checkout region', () => {
    render(<CheckoutFormCard sale={saleWithState('ACTIVE')} />);
    expect(screen.getByRole('region', { name: 'Checkout' })).toBeInTheDocument();
  });
});

describe('CheckoutFormCard random user', () => {
  it('fills a valid test user id and changes it on a second click', async () => {
    const user = userEvent.setup();
    render(<CheckoutFormCard sale={saleWithState('ACTIVE')} />);

    await user.click(screen.getByRole('button', { name: 'Random Test User' }));
    const first = userIdInput().value;
    await user.click(screen.getByRole('button', { name: 'Random Test User' }));

    expect(first).toMatch(/^test-user-[0-9a-f]{8}$/);
    expect(userIdInput().value).toMatch(/^test-user-[0-9a-f]{8}$/);
    expect(userIdInput().value).not.toBe(first);
  });
});

describe('CheckoutFormCard submitting', () => {
  it('keeps the previous result in place during a repeated purchase and replaces it with the new result', async () => {
    let resolveRetry: (response: Response) => void = () => undefined;
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          jsonResponse(409, { code: 'ALREADY_PURCHASED', message: 'Already bought' }),
        );
      }
      return new Promise<Response>((resolve) => {
        resolveRetry = resolve;
      });
    });
    const user = await buyActive();
    const priorAlert = await screen.findByRole('alert');

    await user.click(buyNow());
    expect(buyNow()).toBeDisabled();
    expect(buyNow()).toHaveTextContent('Processing...');
    expect(screen.getByRole('alert')).toBe(priorAlert);
    expect(priorAlert).toHaveTextContent('Already purchased');
    await act(async () =>
      resolveRetry(jsonResponse(410, { code: 'SOLD_OUT', message: 'No stock' })),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Sold out');
    expect(buyNow()).toBeEnabled();
  });

  it('locks Buy Now while the request is pending and keeps its name', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    await buyActive();
    expect(buyNow()).toBeDisabled();
    expect(buyNow()).toHaveAttribute('aria-busy', 'true');
    expect(buyNow()).toHaveTextContent('Processing...');
    expect(userIdInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Random Test User' })).toBeDisabled();
  });

  it('shows the reservation feedback with the order id on 202', async () => {
    stubFetch(async (url) =>
      url === PURCHASE_URL
        ? reservedResponse('alice')
        : orderStatusResponse('RESERVED', 'alice', ORDER_ID),
    );
    await buyActive();
    expect(await screen.findByText('Reserved! Confirming your order...')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ORDER_ID))).toBeInTheDocument();
  });

  it.each(OUTCOME_CASES)(
    'shows "$title" and the server message on $status $code',
    async (outcome) => {
      stubFetch(async () =>
        jsonResponse(outcome.status, { code: outcome.code, message: outcome.message }),
      );
      await buyActive();
      expect(await screen.findByText(outcome.title)).toBeInTheDocument();
      expect(screen.getByText(outcome.message)).toBeInTheDocument();
    },
  );

  it('falls back to a generic failure title for an unknown code', async () => {
    stubFetch(async () => jsonResponse(503, { code: 'SOMETHING_NEW', message: 'Try again soon' }));
    await buyActive();
    expect(await screen.findByText('Purchase failed')).toBeInTheDocument();
    expect(screen.getByText('Try again soon')).toBeInTheDocument();
  });
});

describe('CheckoutFormCard onPurchaseReserved', () => {
  const step = (ms: number): Promise<unknown> => act(async () => vi.advanceTimersByTimeAsync(ms));
  const submitAlice = async (): Promise<void> => {
    fireEvent.change(userIdInput(), { target: { value: 'alice' } });
    fireEvent.click(buyNow());
    await step(0);
  };

  it('fires once on 202 and again on confirmed without spamming on rerender', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    stubCheckoutFlow('CONFIRMED');
    const onReserved = vi.fn();
    const sale = saleWithState('ACTIVE');
    const view = render(<CheckoutFormCard sale={sale} onPurchaseReserved={onReserved} />);
    const redraw = (stock: number): void =>
      view.rerender(
        <CheckoutFormCard
          sale={{ ...sale, remainingStock: stock }}
          onPurchaseReserved={() => onReserved()}
        />,
      );
    await submitAlice();
    expect(onReserved).toHaveBeenCalledTimes(1);
    redraw(36);
    await step(1_000);
    expect(onReserved).toHaveBeenCalledTimes(2);
    redraw(35);
    expect(onReserved).toHaveBeenCalledTimes(2);
  });

  it('fires on released transition and never on rejected purchase', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const onReserved = vi.fn();
    stubFetch(async () => jsonResponse(409, { code: 'ALREADY_PURCHASED', message: 'Already' }));
    const active = saleWithState('ACTIVE');
    const view = render(<CheckoutFormCard sale={active} onPurchaseReserved={onReserved} />);
    await submitAlice();
    expect(onReserved).not.toHaveBeenCalled();
    stubCheckoutFlow('NONE');
    view.rerender(<CheckoutFormCard sale={active} onPurchaseReserved={onReserved} />);
    fireEvent.click(buyNow());
    await step(0);
    await step(1_000);
    expect(onReserved).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh confirmation poll when retrying the same user after released', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    let purchases = 0;
    let order2Polls = 0;
    stubFetch(async (url) => {
      if (url === PURCHASE_URL) {
        purchases += 1;
        return reservedResponse('alice', `order-${purchases}`);
      }
      if (purchases === 1) return orderStatusResponse('NONE', 'alice');
      order2Polls += 1;
      return orderStatusResponse(order2Polls === 1 ? 'RESERVED' : 'CONFIRMED', 'alice', 'order-2');
    });
    render(<CheckoutFormCard sale={saleWithState('ACTIVE')} />);
    await submitAlice();
    expect(screen.getByRole('alert')).toHaveTextContent('Reservation released');

    fireEvent.click(buyNow());
    await step(0);
    expect(screen.getByText('Reserved! Confirming your order...')).toBeInTheDocument();
    expect(screen.getByText(/order-2/)).toBeInTheDocument();

    await step(1_000);
    expect(screen.getByRole('status')).toHaveTextContent('Order confirmed');
    expect(screen.getByText('order-2')).toBeInTheDocument();
  });
});
