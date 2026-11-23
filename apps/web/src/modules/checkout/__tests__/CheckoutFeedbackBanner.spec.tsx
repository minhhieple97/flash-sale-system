import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConfirmationState } from '@/modules/orders';
import { CheckoutFeedbackBanner } from '../components/CheckoutFeedbackBanner';
import type { FeedbackCode, PurchaseAttemptState } from '../types/checkout.types';
import { ORDER_ID } from './checkout-fixtures';

const FALLBACK_TITLE = 'Purchase failed';
const RESERVATION = { orderId: ORDER_ID, userId: 'alice', message: 'reserved' };

interface BannerProps {
  state: PurchaseAttemptState;
  confirmation: ConfirmationState;
}

function failure(code: string): BannerProps {
  return {
    state: { status: 'error', error: { code, message: `server said ${code}` } },
    confirmation: { phase: 'idle' },
  };
}

function reserved(confirmation: ConfirmationState): BannerProps {
  return { state: { status: 'success', data: RESERVATION }, confirmation };
}

const BANNER_FOR_CODE = {
  RESERVED: reserved({ phase: 'polling' }),
  ALREADY_PURCHASED: failure('ALREADY_PURCHASED'),
  SOLD_OUT: failure('SOLD_OUT'),
  SALE_UPCOMING: failure('SALE_UPCOMING'),
  SALE_ENDED: failure('SALE_ENDED'),
  INVALID_USER_ID: failure('INVALID_USER_ID'),
  TEMPORARY_FAILURE: failure('TEMPORARY_FAILURE'),
  RATE_LIMITED: failure('RATE_LIMITED'),
  CONFIRMED: reserved({ phase: 'confirmed', orderId: ORDER_ID }),
  RESERVATION_RELEASED: reserved({ phase: 'released' }),
  STILL_CONFIRMING: reserved({ phase: 'timed-out' }),
} satisfies Record<FeedbackCode, BannerProps>;

const CODES = Object.keys(BANNER_FOR_CODE) as FeedbackCode[];

function renderedTitle(code: FeedbackCode): string {
  const { container } = render(<CheckoutFeedbackBanner {...BANNER_FOR_CODE[code]} />);
  return container.querySelector('p.font-semibold')?.textContent ?? '';
}

describe('CheckoutFeedbackBanner', () => {
  it.each(CODES)('shows a dedicated title for %s, never the fallback', (code) => {
    const title = renderedTitle(code);

    expect(title).not.toBe('');
    expect(title).not.toBe(FALLBACK_TITLE);
  });

  it('gives every code a title no other code uses', () => {
    const titles = CODES.map((code) => {
      const title = renderedTitle(code);
      document.body.innerHTML = '';
      return title;
    });

    expect(new Set(titles).size).toBe(CODES.length);
  });

  it('shows the fallback title only for a code outside the contract', () => {
    render(<CheckoutFeedbackBanner {...failure('SOMETHING_NEW')} />);

    expect(screen.getByText(FALLBACK_TITLE)).toBeInTheDocument();
    expect(screen.getByText('server said SOMETHING_NEW')).toBeInTheDocument();
  });

  it('renders a clear rate-limit warning for RATE_LIMITED', () => {
    render(<CheckoutFeedbackBanner {...failure('RATE_LIMITED')} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Too many requests');
    expect(alert).toHaveTextContent('server said RATE_LIMITED');
  });
});
