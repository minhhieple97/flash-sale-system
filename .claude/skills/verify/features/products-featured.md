# Featured product

Status: implemented (Phase 2.3). Boot hydration (Phase 3.4) seeds the row, so a freshly booted API answers 200.

A shopper sees the one limited-edition product on sale, with its SKU, description, original price and flash price.

## Sub-features

- `product-read` returns 200 `{ id, sku, name, description, originalPriceCents, salePriceCents, imageUrl }` for the featured product id `00000000-0000-4000-8000-000000000002`.
- `product-missing` returns 404 `{ "code": "PRODUCT_NOT_FOUND", "message": ... }` when that row does not exist. Boot recreates the row, so this only shows while the API runs after the row was deleted.
- `product-card` shows the product on the storefront (Phase 4.1).

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/products/featured`.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Present.** Run `.claude/skills/verify/bin/http.sh products-featured present GET /api/v1/products/featured`. It prints `status=200`, `sku` `TITAN-X1-LE`, `originalPriceCents` 24900, `salePriceCents` 12900 and `imageUrl` `null`. Read the row with `docker compose exec -T postgres psql -U flash_sale -d flash_sale -tAc "select id, sku, original_price_cents, sale_price_cents from products"`, which prints that one row.
- **Missing.** This step deletes data, so run it alone and last. `flash_sales` references the product, so delete the sale first, and its orders go with it: `docker compose exec -T postgres psql -U flash_sale -d flash_sale -c "DELETE FROM flash_sales WHERE id='00000000-0000-4000-8000-000000000001'; DELETE FROM products WHERE id='00000000-0000-4000-8000-000000000002';"`. Run `http.sh products-featured missing GET /api/v1/products/featured`. It prints `status=404` with `"code":"PRODUCT_NOT_FOUND"`.
- **Restore.** Run `cleanup.sh`, delete the three Redis keys of the sale (admin-reset.md `Boot hydration`), and run `launch.sh`. Boot seeds the product and a fresh 100-unit campaign, and `present` answers 200 again.
- **Proof.** Keep `present.body.json`, the psql row, and `missing.body.json`.

## Gotchas

- Deleting only the product row fails with `fk_flash_sales_product`. Delete the sale row first.
- Restart with the sale's Redis keys deleted after the missing step. Otherwise hydration finds the old config, keeps the old Redis state, and Redis no longer matches the fresh campaign row. An admin reset with `'{}'` also realigns them.
- The admin reset never touches the product row. Its `productName` changes only the cached sale status.
