import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UserIdField } from '../components/UserIdField';
import { USER_ID_FORMAT_HINT } from '../utils/user-id-validation.util';

function inputElement(): HTMLInputElement {
  return screen.getByLabelText('User ID (username or email)') as HTMLInputElement;
}

describe('UserIdField', () => {
  it('renders an example placeholder showing username or email formats', () => {
    render(<UserIdField value="" disabled={false} onChange={vi.fn()} />);

    expect(inputElement()).toHaveAttribute('placeholder', 'e.g. alice@example.com or john_doe');
  });

  it('renders the format hint linked via aria-describedby without aria-invalid when empty', () => {
    render(<UserIdField value="" disabled={false} onChange={vi.fn()} />);

    const input = inputElement();
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy as string);
    expect(hint?.tagName).toBe('P');
    expect(hint).toHaveTextContent(USER_ID_FORMAT_HINT);
    expect(hint).toHaveClass('text-slate-500');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription(USER_ID_FORMAT_HINT);
  });

  it('does not set aria-invalid for whitespace-only or valid input', () => {
    const { rerender } = render(<UserIdField value="   " disabled={false} onChange={vi.fn()} />);
    expect(inputElement()).not.toHaveAttribute('aria-invalid');

    rerender(<UserIdField value="  Alice@X.io " disabled={false} onChange={vi.fn()} />);
    const input = inputElement();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription(USER_ID_FORMAT_HINT);
  });

  it('marks aria-invalid and shows amber warning hint when input is non-empty and malformed', () => {
    render(<UserIdField value="ab" disabled={false} onChange={vi.fn()} />);

    const input = inputElement();
    const hint = document.getElementById(input.getAttribute('aria-describedby') as string);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(hint).toHaveClass('text-amber-700');
    expect(hint?.textContent).toContain(USER_ID_FORMAT_HINT);
    expect(hint?.textContent).not.toBe(USER_ID_FORMAT_HINT);
  });

  it('forwards changes and honors disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<UserIdField value="" disabled={false} onChange={onChange} />);

    await user.type(inputElement(), 'a');
    expect(onChange).toHaveBeenCalledWith('a');

    rerender(<UserIdField value="alice" disabled={true} onChange={onChange} />);
    expect(inputElement()).toBeDisabled();
  });
});
