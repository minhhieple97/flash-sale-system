import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { orderStatusResponse } from '@/test-support/order-status-stub';
import { App } from '../App';
import { ACTIVE_SALE, ENDED_SALE } from './app-fixtures';

const PRODUCT = {
  id: 'product-1',
  sku: 'TITAN-X1-LE',
  name: 'Titan X1 Carbon Wireless Mechanical Keyboard',
  description: 'Hot-swappable carbon-fiber mechanical keyboard.',
  originalPriceCents: 24900,
  salePriceCents: 12900,
  imageUrl: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(getSale: () => typeof ACTIVE_SALE = () => ACTIVE_SALE): void {
  stubFetch(async (url) => {
    if (url.endsWith('/products/featured')) return jsonResponse(200, PRODUCT);
    if (url.endsWith('/flash-sales/current')) return jsonResponse(200, getSale());
    if (url.endsWith('/admin/flash-sales/reset')) return jsonResponse(200, ENDED_SALE);
    if (url.endsWith('/checkout/purchase')) {
      return jsonResponse(202, {
        code: 'RESERVED',
        orderId: 'order-123',
        userId: 'alice',
        message: 'Your unit is reserved; the order is being confirmed',
      });
    }
    if (url.includes('/orders/user/')) return orderStatusResponse('RESERVED', 'alice');
    return jsonResponse(404, { code: 'NOT_FOUND', message: `Unrouted ${url}` });
  });
}

describe('App', () => {
  it('composes the storefront from every module', async () => {
    stubApi();

    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Flash Sale' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: PRODUCT.name })).toBeInTheDocument();
    expect(await screen.findByText('Live now')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Checkout' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Order lookup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Demo scenarios' })).toBeInTheDocument();
  });

  it('swaps the sale pill to Ended as soon as the Ended Sale scenario is applied', async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Live now');

    await user.click(screen.getByRole('button', { name: 'Demo scenarios' }));
    await user.click(screen.getByRole('button', { name: 'Ended Sale' }));

    expect(await screen.findByText('Ended')).toBeInTheDocument();
    expect(screen.queryByText('Live now')).not.toBeInTheDocument();
  });

  it('clears earlier purchase feedback when a scenario is applied', async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Live now');
    const checkout = screen.getByRole('region', { name: 'Checkout' });
    await user.type(within(checkout).getByLabelText('User ID'), 'alice');
    await user.click(screen.getByRole('button', { name: 'Buy Now' }));
    await screen.findByText('Reserved! Confirming your order...');

    await user.click(screen.getByRole('button', { name: 'Demo scenarios' }));
    await user.click(screen.getByRole('button', { name: 'Active Sale' }));
    await screen.findByText('Ended');

    expect(screen.queryByText('Reserved! Confirming your order...')).not.toBeInTheDocument();
  });

  it('clears an earlier order lookup result when a scenario is applied', async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Live now');
    const lookup = screen.getByRole('region', { name: 'Order lookup' });
    await user.type(within(lookup).getByLabelText('User ID'), 'alice');
    await user.click(within(lookup).getByRole('button', { name: 'Check order' }));
    await within(lookup).findByText('Reserved, awaiting confirmation');

    await user.click(screen.getByRole('button', { name: 'Demo scenarios' }));
    await user.click(screen.getByRole('button', { name: 'Ended Sale' }));
    await screen.findByText('Ended');

    const freshLookup = screen.getByRole('region', { name: 'Order lookup' });
    expect(within(freshLookup).queryByText('Reserved, awaiting confirmation')).toBeNull();
  });

  it('refreshes the displayed stock immediately after a 202 purchase without waiting for polling', async () => {
    let statusCalls = 0;
    const decrementedSale = {
      ...ACTIVE_SALE,
      remainingStock: 99,
      serverTime: new Date(Date.parse(ACTIVE_SALE.serverTime) + 500).toISOString(),
    };
    stubApi(() => {
      statusCalls += 1;
      return statusCalls === 1 ? ACTIVE_SALE : decrementedSale;
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('100 of 100 left')).toBeInTheDocument();

    const checkout = screen.getByRole('region', { name: 'Checkout' });
    await user.type(within(checkout).getByLabelText('User ID'), 'alice');
    await user.click(within(checkout).getByRole('button', { name: 'Buy Now' }));

    expect(await screen.findByText('99 of 100 left')).toBeInTheDocument();
    expect(statusCalls).toBeGreaterThanOrEqual(2);
  });
});
