import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaleStatusBanner } from '../components/SaleStatusBanner';
import type { SaleState } from '../types/flash-sale.types';
import { buildSale, HOUR_MS, isoAt, SERVER_NOW } from './flash-sale-fixtures';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SERVER_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SaleStatusBanner', () => {
  it.each<[SaleState, string]>([
    ['UPCOMING', 'Upcoming'],
    ['ACTIVE', 'Live now'],
    ['SOLD_OUT', 'Sold out'],
    ['ENDED', 'Ended'],
  ])('shows the %s state as the "%s" pill', (saleState, label) => {
    const sale = buildSale({ saleState });

    render(<SaleStatusBanner feed={{ sale, error: null }} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows the stock level as a progress bar and text', () => {
    const sale = buildSale({ totalStock: 100, remainingStock: 37 });

    render(<SaleStatusBanner feed={{ sale, error: null }} />);

    const bar = screen.getByRole('progressbar', { name: 'Stock remaining' });
    expect(bar).toHaveAttribute('aria-valuenow', '37');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('37 of 100 left')).toBeInTheDocument();
  });

  it('shows an empty bar when the total stock is zero', () => {
    const sale = buildSale({ totalStock: 0, remainingStock: 0, saleState: 'SOLD_OUT' });

    render(<SaleStatusBanner feed={{ sale, error: null }} />);

    expect(screen.getByRole('progressbar', { name: 'Stock remaining' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('counts down to the start under a skewed client clock for an upcoming sale', () => {
    vi.setSystemTime(SERVER_NOW + HOUR_MS);
    const sale = buildSale({ saleState: 'UPCOMING', startsAt: isoAt(15_000) });

    render(<SaleStatusBanner feed={{ sale, error: null }} />);

    expect(screen.getByRole('timer')).toHaveTextContent('Starts in 00:00:15');
  });

  it('counts down to the end for an active sale', () => {
    const sale = buildSale({ saleState: 'ACTIVE', endsAt: isoAt(HOUR_MS) });

    render(<SaleStatusBanner feed={{ sale, error: null }} />);

    expect(screen.getByRole('timer')).toHaveTextContent('Ends in 01:00:00');
  });

  it.each<SaleState>(['SOLD_OUT', 'ENDED'])(
    'shows no countdown when the sale is %s',
    (saleState) => {
      const sale = buildSale({ saleState });

      render(<SaleStatusBanner feed={{ sale, error: null }} />);

      expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    },
  );

  it('shows a loading placeholder before the first response', () => {
    render(<SaleStatusBanner feed={{ sale: null, error: null }} />);

    expect(screen.getByRole('status', { name: 'Loading sale status' })).toBeInTheDocument();
  });

  it('shows an error alert with the API message when there is no sale', () => {
    const error = { code: 'NO_SALE', message: 'No sale is configured.' };

    render(<SaleStatusBanner feed={{ sale: null, error }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('No sale is configured.');
  });

  it('keeps showing the last sale with a reconnecting note when a poll fails', () => {
    const error = { code: 'NETWORK_ERROR', message: 'Could not reach the server.' };

    render(<SaleStatusBanner feed={{ sale: buildSale(), error }} />);

    expect(screen.getByText('Live now')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no reconnecting note while the feed is healthy', () => {
    render(<SaleStatusBanner feed={{ sale: buildSale(), error: null }} />);

    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument();
  });

  it.each([
    ['live', { sale: buildSale(), error: null }],
    ['loading', { sale: null, error: null }],
    ['failed', { sale: null, error: { code: 'NO_SALE', message: 'No sale.' } }],
  ])('is a region named "Sale status" while %s', (_label, feed) => {
    render(<SaleStatusBanner feed={feed} />);

    expect(screen.getByRole('region', { name: 'Sale status' })).toBeInTheDocument();
  });
});
