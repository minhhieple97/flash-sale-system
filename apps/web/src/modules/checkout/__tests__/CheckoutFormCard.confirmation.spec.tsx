import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { CheckoutFormCard } from '../components/CheckoutFormCard';
import { ORDER_ID, PURCHASE_URL, reservedResponse } from './checkout-fixtures';

const CLOCK_FAKES = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;
const ORDER_STATUS_URL = '/api/v1/orders/user/alice';

type OrderAnswer = (call: number) => Response;

function advance(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function stubCheckoutApi(answerOrder: OrderAnswer): ReturnType<typeof stubFetch> {
  let orderCalls = 0;
  return stubFetch(async (url) => {
    if (url === PURCHASE_URL) return reservedResponse('alice');
    orderCalls += 1;
    return answerOrder(orderCalls);
  });
}

function orderRequests(fetchStub: ReturnType<typeof stubFetch>): number {
  return fetchStub.mock.calls.filter(([url]) => url === ORDER_STATUS_URL).length;
}

async function buyAs(userId: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: userId } });
  fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }));
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...CLOCK_FAKES] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CheckoutFormCard order confirmation', () => {
  it('keeps the reserved feedback while the order is still RESERVED', async () => {
    stubCheckoutApi(() => orderStatusResponse('RESERVED', 'alice', ORDER_ID));
    render(<CheckoutFormCard saleState="ACTIVE" />);

    await buyAs('alice');
    await advance(400);

    expect(screen.getByText('Reserved! Confirming your order...')).toBeInTheDocument();
    expect(screen.queryByText('Order confirmed')).toBeNull();
  });

  it('polls the order status of the server-normalized user id after a 202', async () => {
    const fetchStub = stubFetch(async (url) =>
      url === PURCHASE_URL
        ? reservedResponse('alice@x.io')
        : orderStatusResponse('RESERVED', 'alice@x.io', ORDER_ID),
    );
    render(<CheckoutFormCard saleState="ACTIVE" />);

    await buyAs('  Alice@X.io ');

    expect(fetchStub.mock.calls.at(-1)?.[0]).toBe('/api/v1/orders/user/alice%40x.io');
  });

  it('shows Order confirmed with the receipt once the order is CONFIRMED and stops polling', async () => {
    const fetchStub = stubCheckoutApi((call) =>
      orderStatusResponse(call < 3 ? 'RESERVED' : 'CONFIRMED', 'alice', ORDER_ID),
    );
    render(<CheckoutFormCard saleState="ACTIVE" />);
    await buyAs('alice');

    await advance(800);

    const feedback = screen.getByRole('status');
    expect(feedback).toHaveTextContent('Order confirmed');
    expect(feedback).toHaveTextContent(ORDER_ID);
    expect(feedback).toHaveTextContent('alice');
    expect(screen.queryByText('Reserved! Confirming your order...')).toBeNull();
    const requestsAtConfirmation = orderRequests(fetchStub);
    await advance(4000);
    expect(orderRequests(fetchStub)).toBe(requestsAtConfirmation);
    expect(requestsAtConfirmation).toBe(3);
  });

  it('shows Reservation released when the order status goes NONE', async () => {
    stubCheckoutApi((call) =>
      call < 2
        ? orderStatusResponse('RESERVED', 'alice', ORDER_ID)
        : orderStatusResponse('NONE', 'alice'),
    );
    render(<CheckoutFormCard saleState="ACTIVE" />);
    await buyAs('alice');

    await advance(400);

    expect(screen.getByRole('alert')).toHaveTextContent('Reservation released');
    expect(screen.queryByText('Reserved! Confirming your order...')).toBeNull();
  });

  it('shows Still confirming after 75 attempts without a final answer', async () => {
    const fetchStub = stubCheckoutApi(() => orderStatusResponse('RESERVED', 'alice', ORDER_ID));
    render(<CheckoutFormCard saleState="ACTIVE" />);
    await buyAs('alice');

    await advance(400 * 74);

    expect(screen.getByRole('status')).toHaveTextContent('Still confirming');
    expect(orderRequests(fetchStub)).toBe(75);
    await advance(5000);
    expect(orderRequests(fetchStub)).toBe(75);
  });

  it('does not poll after a rejected purchase', async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(409, { code: 'ALREADY_PURCHASED', message: 'Already bought' }),
    );
    render(<CheckoutFormCard saleState="ACTIVE" />);

    await buyAs('alice');
    await advance(4000);

    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
