# Featured product

Status: implemented (API Phase 2.3, storefront card Phase 4.1). Boot hydration (Phase 3.4) seeds the row, so a freshly booted API answers 200.

A shopper sees the one limited-edition product on sale, with its SKU, description, original price and flash price.

## Sub-features

- `product-read` returns 200 `{ id, sku, name, description, originalPriceCents, salePriceCents, imageUrl }` for the featured product id `00000000-0000-4000-8000-000000000002`.
- `product-missing` returns 404 `{ "code": "PRODUCT_NOT_FOUND", "message": ... }` when that row does not exist. Boot recreates the row, so this only shows while the API runs after the row was deleted.
- `product-card` shows the product on the storefront: name, description, SKU badge, "Limited Edition" badge, "Limit 1 Per Customer" tag, the flash price, the struck-through original price and the discount badge.

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/products/featured`.
- The product card at the top of the storefront at `/`.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Present.** Run `.claude/skills/verify/bin/http.sh products-featured present GET /api/v1/products/featured`. It prints `status=200`, `sku` `TITAN-X1-LE`, `originalPriceCents` 24900, `salePriceCents` 12900 and `imageUrl` `null`. Read the row with `docker compose exec -T postgres psql -U flash_sale -d flash_sale -tAc "select id, sku, original_price_cents, sale_price_cents from products"`, which prints that one row.
- **Card.** Run `.claude/skills/verify/bin/ui.sh products-featured product-card '[{"goto":"/"},{"expect":{"text":"TITAN-X1-LE","exact":true}},{"expect":{"text":"Limited Edition","exact":true}},{"expect":{"text":"Limit 1 Per Customer","exact":true}},{"expect":{"text":"$129.00","exact":true}},{"expect":{"text":"$249.00","exact":true}},{"expect":{"text":"48% OFF","exact":true}}]'`. Every step logs `PASS`, and `product-card.png` shows the card. The `$249.00` is inside a `<del>` in `product-card.dom.html`.
- **Missing.** This step deletes data, so run it alone and last. `flash_sales` references the product, so delete the sale first, and its orders go with it: `docker compose exec -T postgres psql -U flash_sale -d flash_sale -c "DELETE FROM flash_sales WHERE id='00000000-0000-4000-8000-000000000001'; DELETE FROM products WHERE id='00000000-0000-4000-8000-000000000002';"`. Run `http.sh products-featured missing GET /api/v1/products/featured`. It prints `status=404` with `"code":"PRODUCT_NOT_FOUND"`.
- **Restore.** Run `cleanup.sh`, delete the three Redis keys of the sale (admin-reset.md `Boot hydration`), and run `launch.sh`. Boot seeds the product and a fresh 100-unit campaign, and `present` answers 200 again.
- **Proof.** Keep `present.body.json`, the psql row, `missing.body.json`, and `product-card.steps.log` with its DOM and screenshot.

## Gotchas

- Deleting only the product row fails with `fk_flash_sales_product`. Delete the sale row first.
- Restart with the sale's Redis keys deleted after the missing step. Otherwise hydration finds the old config, keeps the old Redis state, and Redis no longer matches the fresh campaign row. An admin reset with `'{}'` also realigns them.
- The admin reset never touches the product row. Its `productName` changes only the cached sale status.
- The seed has `imageUrl: null`, so the card shows a decorative gradient placeholder rather than an `<img>`.
- Vite dev has no favicon, so each `ui.sh` page load logs one `CONSOLE-ERROR Failed to load resource: ... 404 (Not Found)`. That is `/favicon.ico` (confirmed over CDP in run 20261121-103948). Playwright's response events skip favicon requests, so no matching `HTTP 404` line appears.
