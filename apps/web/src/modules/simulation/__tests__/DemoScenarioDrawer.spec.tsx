import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '@/test-support/fetch-stub';
import { DemoScenarioDrawer } from '../components/DemoScenarioDrawer';
import type { ResetFlashSalePayload } from '../types/simulation.types';
import { buildSale, RESET_URL } from './simulation-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PRESET_CASES: ReadonlyArray<[string, ResetFlashSalePayload]> = [
  ['Active Sale', { totalStock: 100, startsOffsetSeconds: 0, durationSeconds: 3600 }],
  ['High Scarcity', { totalStock: 3, startsOffsetSeconds: 0, durationSeconds: 3600 }],
  ['Upcoming Countdown', { totalStock: 100, startsOffsetSeconds: 15, durationSeconds: 3600 }],
  ['Ended Sale', { totalStock: 100, startsOffsetSeconds: -7200, durationSeconds: 3600 }],
];

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: 'Demo scenarios' });
}

async function openDrawer(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(toggle());
  return user;
}

describe('DemoScenarioDrawer', () => {
  it('is collapsed by default with no preset buttons', () => {
    render(<DemoScenarioDrawer onScenarioApplied={vi.fn()} />);

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Active Sale' })).not.toBeInTheDocument();
  });

  it('shows the four presets with their descriptions when expanded and hides Admin key by default', async () => {
    render(<DemoScenarioDrawer onScenarioApplied={vi.fn()} />);

    await openDrawer();

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    for (const [label] of PRESET_CASES) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'High Scarcity' })).toHaveAccessibleDescription(
      '3 stock left',
    );
    expect(screen.queryByLabelText('Admin key')).not.toBeInTheDocument();
  });

  it('collapses again when the toggle is clicked a second time', async () => {
    render(<DemoScenarioDrawer onScenarioApplied={vi.fn()} />);
    const user = await openDrawer();

    await user.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Ended Sale' })).not.toBeInTheDocument();
  });

  it.each(PRESET_CASES)('posts the %s payload to the reset endpoint', async (label, payload) => {
    const fetchStub = stubFetch(async () => jsonResponse(200, buildSale()));
    render(<DemoScenarioDrawer onScenarioApplied={vi.fn()} />);
    const user = await openDrawer();

    await user.click(screen.getByRole('button', { name: label }));

    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESET_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it('hands the returned sale status to onScenarioApplied and marks the preset live', async () => {
    const sale = buildSale({ totalStock: 3, remainingStock: 3 });
    stubFetch(async () => jsonResponse(200, sale));
    const onScenarioApplied = vi.fn();
    render(<DemoScenarioDrawer onScenarioApplied={onScenarioApplied} />);
    const user = await openDrawer();

    await user.click(screen.getByRole('button', { name: 'High Scarcity' }));

    expect(onScenarioApplied).toHaveBeenCalledExactlyOnceWith(sale);
    expect(await screen.findByRole('status')).toHaveTextContent('High Scarcity');
  });

  it('disables every preset button while one scenario is applying', async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    render(<DemoScenarioDrawer onScenarioApplied={vi.fn()} />);
    const user = await openDrawer();

    await user.click(screen.getByRole('button', { name: 'Active Sale' }));

    for (const [label] of PRESET_CASES) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Active Sale' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Applying: Active Sale');
  });

  it('shows the API message in an alert and skips the callback when the reset fails', async () => {
    stubFetch(async () =>
      jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'Unexpected server error' }),
    );
    const onScenarioApplied = vi.fn();
    render(<DemoScenarioDrawer onScenarioApplied={onScenarioApplied} />);
    const user = await openDrawer();

    await user.click(screen.getByRole('button', { name: 'Ended Sale' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not apply Ended Sale');
    expect(alert).toHaveTextContent('Unexpected server error');
    expect(onScenarioApplied).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ended Sale' })).toBeEnabled();
  });

  it('shows a friendly info notice on NOT_FOUND without triggering an alert', async () => {
    stubFetch(async () =>
      jsonResponse(404, { code: 'NOT_FOUND', message: 'Admin endpoints are disabled' }),
    );
    const onScenarioApplied = vi.fn();
    render(<DemoScenarioDrawer onScenarioApplied={onScenarioApplied} />);
    const user = await openDrawer();

    await user.click(screen.getByRole('button', { name: 'Ended Sale' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Demo resets disabled');
    expect(status).toHaveTextContent('Admin endpoints are disabled');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onScenarioApplied).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ended Sale' })).toBeEnabled();
  });

  it('shows a warning alert and Admin key password field on 401, then resends with x-admin-key', async () => {
    let calls = 0;
    const sale = buildSale({ saleState: 'ENDED' });
    const fetchStub = stubFetch(async (_url, init) => {
      calls += 1;
      const key = new Headers(init?.headers).get('x-admin-key');
      if (key === 'secret-admin') return jsonResponse(200, sale);
      return jsonResponse(401, { code: 'UNAUTHORIZED', message: 'Valid admin key is required' });
    });
    const onScenarioApplied = vi.fn();
    render(<DemoScenarioDrawer onScenarioApplied={onScenarioApplied} />);
    const user = await openDrawer();

    await user.click(screen.getByRole('button', { name: 'Ended Sale' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Admin key required');
    expect(alert).toHaveTextContent('Valid admin key is required');
    expect(onScenarioApplied).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ended Sale' })).toBeEnabled();

    const keyInput = screen.getByLabelText('Admin key');
    expect(keyInput).toHaveAttribute('type', 'password');
    await user.type(keyInput, 'secret-admin');
    await user.click(screen.getByRole('button', { name: 'Ended Sale' }));

    expect(calls).toBe(2);
    expect(new Headers(fetchStub.mock.calls[1]?.[1]?.headers).get('x-admin-key')).toBe(
      'secret-admin',
    );
    expect(onScenarioApplied).toHaveBeenCalledExactlyOnceWith(sale);
    expect(await screen.findByRole('status')).toHaveTextContent('Ended Sale');
    expect(screen.getByLabelText('Admin key')).toBeInTheDocument();
  });
});
