# Featured product

Status: implemented (Phase 2.3). The catalog is seeded by Phase 3.4 hydration. Until then an unseeded database answers 404 `PRODUCT_NOT_FOUND`.

A shopper sees the one limited-edition product on sale, with its SKU, description, original price and flash price.

## Sub-features

- `product-read` returns 200 `{ id, sku, name, description, originalPriceCents, salePriceCents, imageUrl }` for the featured product id `00000000-0000-4000-8000-000000000002`.
- `product-missing` returns 404 `{ "code": "PRODUCT_NOT_FOUND", "message": ... }` when that row does not exist.
- `product-card` shows the product on the storefront (Phase 4.1).

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/products/featured`.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Missing.** On an unseeded database, run `.claude/skills/verify/bin/http.sh products-featured missing GET /api/v1/products/featured`. It prints `status=404` with `"code":"PRODUCT_NOT_FOUND"`.
- **Present.** Once Phase 3.4 hydration exists, the API seeds the row at boot. Before that, seed the exact row hydration will write and remove it afterwards: `docker compose exec -T postgres psql -U flash_sale -d flash_sale -c "INSERT INTO products (id, sku, name, description, original_price_cents, sale_price_cents) VALUES ('00000000-0000-4000-8000-000000000002', 'TITAN-X1-LE', 'Titan X1 Carbon Wireless Mechanical Keyboard', 'Limited edition', 24900, 12900) ON CONFLICT (id) DO NOTHING"`. Then run `http.sh products-featured present GET /api/v1/products/featured`. It prints `status=200`, `sku` `TITAN-X1-LE` and integer cents. Clean up with `DELETE FROM products WHERE id = '00000000-0000-4000-8000-000000000002'`.
- **Proof.** Keep `missing.body.json` and `present.body.json`, plus the psql output of the seed and the cleanup.

## Gotchas

- Hand seeding is a Phase 2-only precondition. Once the admin reset and hydration exist, use them instead (README.md driving conventions).
