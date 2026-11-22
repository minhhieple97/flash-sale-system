const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const CENTS_PER_DOLLAR = 100;

export function formatCents(cents: number): string {
  return USD.format(cents / CENTS_PER_DOLLAR);
}

export function discountPercent(originalCents: number, saleCents: number): number {
  if (originalCents <= 0 || saleCents >= originalCents) return 0;
  return Math.round(((originalCents - saleCents) / originalCents) * 100);
}
