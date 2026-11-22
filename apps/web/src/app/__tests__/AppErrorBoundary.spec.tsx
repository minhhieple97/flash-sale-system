import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../AppErrorBoundary';

function Crash(): ReactElement {
  throw new Error('render exploded');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>storefront</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('storefront')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('replaces a crashed tree with an alert instead of a blank page', () => {
    render(
      <AppErrorBoundary>
        <Crash />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('reloads the page when the reload button is clicked', async () => {
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(
      <AppErrorBoundary onReload={onReload}>
        <Crash />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Reload page' }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
