import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaleState } from '@/modules/flash-sale';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { CheckoutFormCard } from '../components/CheckoutFormCard';
import { ORDER_ID, OUTCOME_CASES, PURCHASE_URL, reservedResponse } from './checkout-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function buyNow(): HTMLElement {
  return screen.getByRole('button', { name: 'Buy Now' });
}

function userIdInput(): HTMLInputElement {
  return screen.getByLabelText('User ID') as HTMLInputElement;
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
      render(<CheckoutFormCard saleState={saleState} />);

      await user.type(userIdInput(), 'alice');

      expect(buyNow()).toBeDisabled();
      expect(screen.getByText(reason)).toBeInTheDocument();
    },
  );

  it('enables Buy Now for an active sale with a user id and shows no reason', async () => {
    const user = userEvent.setup();
    render(<CheckoutFormCard saleState="ACTIVE" />);

    await user.type(userIdInput(), 'alice');

    expect(buyNow()).toBeEnabled();
    expect(screen.queryByText(/sale has not started yet\.|sold out\.|has ended\./)).toBeNull();
  });

  it('disables Buy Now for a blank user id', async () => {
    const user = userEvent.setup();
    render(<CheckoutFormCard saleState="ACTIVE" />);

    await user.type(userIdInput(), '   ');

    expect(buyNow()).toBeDisabled();
  });

  it('exposes the card as a Checkout region', () => {
    render(<CheckoutFormCard saleState="ACTIVE" />);

    expect(screen.getByRole('region', { name: 'Checkout' })).toBeInTheDocument();
  });
});

describe('CheckoutFormCard random user', () => {
  it('fills a valid test user id and changes it on a second click', async () => {
    const user = userEvent.setup();
    render(<CheckoutFormCard saleState="ACTIVE" />);

    await user.click(screen.getByRole('button', { name: 'Random Test User' }));
    const first = userIdInput().value;
    await user.click(screen.getByRole('button', { name: 'Random Test User' }));

    expect(first).toMatch(/^test-user-[0-9a-f]{8}$/);
    expect(userIdInput().value).toMatch(/^test-user-[0-9a-f]{8}$/);
    expect(userIdInput().value).not.toBe(first);
  });
});

describe('CheckoutFormCard submitting', () => {
  it('locks Buy Now while the request is pending and keeps its name', async () => {
    const user = userEvent.setup();
    stubFetch(() => new Promise<Response>(() => undefined));
    render(<CheckoutFormCard saleState="ACTIVE" />);
    await user.type(userIdInput(), 'alice');

    await user.click(buyNow());

    expect(buyNow()).toBeDisabled();
    expect(buyNow()).toHaveAttribute('aria-busy', 'true');
    expect(buyNow()).toHaveTextContent('Processing...');
    expect(userIdInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Random Test User' })).toBeDisabled();
  });

  it('shows the reservation feedback with the order id on 202', async () => {
    const user = userEvent.setup();
    stubFetch(async (url) =>
      url === PURCHASE_URL
        ? reservedResponse('alice')
        : orderStatusResponse('RESERVED', 'alice', ORDER_ID),
    );
    render(<CheckoutFormCard saleState="ACTIVE" />);
    await user.type(userIdInput(), 'alice');

    await user.click(buyNow());

    expect(await screen.findByText('Reserved! Confirming your order...')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ORDER_ID))).toBeInTheDocument();
  });

  it.each(OUTCOME_CASES)(
    'shows "$title" and the server message on $status $code',
    async (outcome) => {
      const user = userEvent.setup();
      stubFetch(async () =>
        jsonResponse(outcome.status, { code: outcome.code, message: outcome.message }),
      );
      render(<CheckoutFormCard saleState="ACTIVE" />);
      await user.type(userIdInput(), 'alice');

      await user.click(buyNow());

      expect(await screen.findByText(outcome.title)).toBeInTheDocument();
      expect(screen.getByText(outcome.message)).toBeInTheDocument();
    },
  );

  it('falls back to a generic failure title for an unknown code', async () => {
    const user = userEvent.setup();
    stubFetch(async () =>
      jsonResponse(503, { code: 'TEMPORARY_FAILURE', message: 'Try again soon' }),
    );
    render(<CheckoutFormCard saleState="ACTIVE" />);
    await user.type(userIdInput(), 'alice');

    await user.click(buyNow());

    expect(await screen.findByText('Purchase failed')).toBeInTheDocument();
    expect(screen.getByText('Try again soon')).toBeInTheDocument();
  });
});
