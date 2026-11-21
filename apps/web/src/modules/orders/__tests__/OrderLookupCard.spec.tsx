import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { OrderLookupCard } from '../components/OrderLookupCard';

afterEach(() => {
  vi.unstubAllGlobals();
});

function checkOrder(): HTMLElement {
  return screen.getByRole('button', { name: 'Check order' });
}

function userIdInput(): HTMLInputElement {
  return screen.getByLabelText('User ID') as HTMLInputElement;
}

describe('OrderLookupCard layout', () => {
  it('is an Order lookup region with a labelled User ID input and a Check order button', () => {
    render(<OrderLookupCard />);

    const region = screen.getByRole('region', { name: 'Order lookup' });
    expect(region).toContainElement(userIdInput());
    expect(region).toContainElement(checkOrder());
  });

  it('disables Check order for a blank user id', async () => {
    const user = userEvent.setup();
    render(<OrderLookupCard />);
    expect(checkOrder()).toBeDisabled();

    await user.type(userIdInput(), '   ');

    expect(checkOrder()).toBeDisabled();
  });

  it('enables Check order once a user id is typed', async () => {
    const user = userEvent.setup();
    render(<OrderLookupCard />);

    await user.type(userIdInput(), 'alice');

    expect(checkOrder()).toBeEnabled();
  });

  it('locks Check order while the lookup is pending and keeps its name', async () => {
    const user = userEvent.setup();
    stubFetch(() => new Promise<Response>(() => undefined));
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'alice');

    await user.click(checkOrder());

    expect(checkOrder()).toBeDisabled();
    expect(checkOrder()).toHaveAttribute('aria-busy', 'true');
    expect(checkOrder()).toHaveTextContent('Checking...');
    expect(userIdInput()).toBeDisabled();
  });
});

describe('OrderLookupCard results', () => {
  it('requests the URL-encoded user id when Check order is clicked', async () => {
    const user = userEvent.setup();
    const fetchStub = stubFetch(async () => orderStatusResponse('NONE', 'a+b@x.io'));
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'a+b@x.io');

    await user.click(checkOrder());

    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/orders/user/a%2Bb%40x.io');
  });

  it('shows the verified receipt with the order id for a CONFIRMED order', async () => {
    const user = userEvent.setup();
    stubFetch(async () => orderStatusResponse('CONFIRMED', 'alice', 'order-777'));
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'alice');

    await user.click(checkOrder());

    expect(await screen.findByText('Order confirmed')).toBeInTheDocument();
    expect(screen.getByText('order-777')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('shows the pending text with the order id for a RESERVED order', async () => {
    const user = userEvent.setup();
    stubFetch(async () => orderStatusResponse('RESERVED', 'alice', 'order-888'));
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'alice');

    await user.click(checkOrder());

    expect(await screen.findByText('Reserved, awaiting confirmation')).toBeInTheDocument();
    expect(screen.getByText(/order-888/)).toBeInTheDocument();
  });

  it('says no order was found for a user without one', async () => {
    const user = userEvent.setup();
    stubFetch(async () => orderStatusResponse('NONE', 'ghost'));
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'ghost');

    await user.click(checkOrder());

    expect(await screen.findByText('No order found for ghost')).toBeInTheDocument();
  });

  it('shows the API message when the user id is rejected with a 400', async () => {
    const user = userEvent.setup();
    stubFetch(async () =>
      jsonResponse(400, { code: 'INVALID_USER_ID', message: 'userId must be 3 to 128 characters' }),
    );
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'ab');

    await user.click(checkOrder());

    expect(await screen.findByText('userId must be 3 to 128 characters')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('replaces an earlier result when a second lookup answers differently', async () => {
    const user = userEvent.setup();
    let call = 0;
    stubFetch(async () => {
      call += 1;
      return call === 1
        ? orderStatusResponse('RESERVED', 'alice', 'order-1')
        : orderStatusResponse('CONFIRMED', 'alice', 'order-1');
    });
    render(<OrderLookupCard />);
    await user.type(userIdInput(), 'alice');
    await user.click(checkOrder());
    await screen.findByText('Reserved, awaiting confirmation');

    await user.click(checkOrder());

    expect(await screen.findByText('Order confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Reserved, awaiting confirmation')).toBeNull();
  });
});
