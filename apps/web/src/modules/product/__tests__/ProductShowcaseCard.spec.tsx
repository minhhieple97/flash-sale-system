import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '../../../test-support/fetch-stub';
import { ProductShowcaseCard } from '../components/ProductShowcaseCard';
import type { Product } from '../types/product.types';

const PRODUCT: Product = {
  id: 'p1',
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

describe('ProductShowcaseCard', () => {
  it('requests the featured product from the API', async () => {
    const fetchStub = stubFetch(async () => jsonResponse(200, PRODUCT));

    render(<ProductShowcaseCard />);

    await screen.findByRole('heading', { name: PRODUCT.name });
    expect(fetchStub.mock.calls[0]?.[0]).toBe('/api/v1/products/featured');
  });

  it('shows a loading placeholder before the response arrives', () => {
    stubFetch(() => new Promise<Response>(() => undefined));

    render(<ProductShowcaseCard />);

    expect(screen.getByRole('status', { name: 'Loading product' })).toBeInTheDocument();
  });

  it('renders the product name, description, SKU and limited-edition labels', async () => {
    stubFetch(async () => jsonResponse(200, PRODUCT));

    render(<ProductShowcaseCard />);

    expect(await screen.findByRole('heading', { name: PRODUCT.name })).toBeInTheDocument();
    expect(screen.getByText(PRODUCT.description)).toBeInTheDocument();
    expect(screen.getByText('TITAN-X1-LE')).toBeInTheDocument();
    expect(screen.getByText('Limited Edition')).toBeInTheDocument();
    expect(screen.getByText('Limit 1 Per Customer')).toBeInTheDocument();
  });

  it('shows the sale price, the struck-through original price and the discount', async () => {
    stubFetch(async () => jsonResponse(200, PRODUCT));

    render(<ProductShowcaseCard />);

    expect(await screen.findByText('$129.00')).toBeInTheDocument();
    const original = screen.getByText('$249.00');
    expect(original.tagName).toBe('DEL');
    expect(screen.getByText('48% OFF')).toBeInTheDocument();
    expect(original.parentElement).toHaveTextContent('Original price');
  });

  it('shows the API message in an alert when the product is not found', async () => {
    stubFetch(async () =>
      jsonResponse(404, { code: 'PRODUCT_NOT_FOUND', message: 'No featured product' }),
    );

    render(<ProductShowcaseCard />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No featured product');
    expect(screen.queryByRole('status', { name: 'Loading product' })).not.toBeInTheDocument();
  });

  it('renders a decorative placeholder when the product has no image', async () => {
    stubFetch(async () => jsonResponse(200, PRODUCT));

    render(<ProductShowcaseCard />);

    await screen.findByRole('heading', { name: PRODUCT.name });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('product-image-placeholder')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the product image with the product name as alt text when present', async () => {
    stubFetch(async () =>
      jsonResponse(200, { ...PRODUCT, imageUrl: 'https://img.test/titan.png' }),
    );

    render(<ProductShowcaseCard />);

    const image = await screen.findByRole('img', { name: PRODUCT.name });
    expect(image).toHaveAttribute('src', 'https://img.test/titan.png');
  });
});
