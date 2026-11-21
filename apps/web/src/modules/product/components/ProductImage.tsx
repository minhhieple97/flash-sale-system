import type { ReactElement } from 'react';

interface ProductImageProps {
  name: string;
  imageUrl: string | null;
}

export function ProductImage({ name, imageUrl }: ProductImageProps): ReactElement {
  if (imageUrl !== null) {
    return <img src={imageUrl} alt={name} className="h-full w-full object-cover" />;
  }
  return (
    <div
      data-testid="product-image-placeholder"
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-24 w-24 text-white/90"
      >
        <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
        <path d="M9 7V5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
