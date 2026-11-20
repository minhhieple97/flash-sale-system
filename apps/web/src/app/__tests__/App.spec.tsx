import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('App', () => {
  it('shows the Flash Sale heading on first render', () => {
    render(<App />);

    const heading = screen.getByRole('heading', { name: 'Flash Sale' });

    expect(heading).toBeInTheDocument();
  });
});
