# Flash sale status

Status: read path implemented (Phase 2.4). Redis is hydrated by Phase 3.4 and states are set by the Phase 3.4 admin reset. Until hydration lands, an empty Redis answers 404 `FLASH_SALE_NOT_FOUND`.

A shopper sees whether the sale is upcoming, active, sold out or ended, with remaining stock and a countdown that is correct even when the shopper's clock is wrong.

## Sub-features

- `status-read` returns `saleId`, `productId`, `productName`, `salePriceCents`, `originalPriceCents`, `saleState`, `totalStock`, `remainingStock`, `startsAt`, `endsAt` and `serverTime` (ISO-8601 strings for the three times).
- `status-missing` returns 404 `{ "code": "FLASH_SALE_NOT_FOUND" }` when Redis holds no config for the active sale.
- `status-states` covers `UPCOMING`, `ACTIVE`, `SOLD_OUT` and `ENDED`.
- `status-banner` shows the state pill, countdown and stock bar on the storefront (Phase 4.2).

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/flash-sales/current`.
- The sale banner on the storefront at `/` (Phase 4.2).

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.
- From Phase 3.4: the admin endpoint is enabled (`ENABLE_ADMIN_ENDPOINTS=true`, the default).

- **Missing (Phase 2).** With no `flash_sale:00000000-0000-4000-8000-000000000001:config` key in Redis, run `.claude/skills/verify/bin/http.sh flash-sale-status missing GET /api/v1/flash-sales/current`. Status 404, `code` `FLASH_SALE_NOT_FOUND`.
- **States (Phase 2, before the admin reset exists).** Seed the hash hydration will write, read, then delete it. Seed with `docker compose exec -T redis redis-cli HSET flash_sale:00000000-0000-4000-8000-000000000001:config saleId 00000000-0000-4000-8000-000000000001 productId 00000000-0000-4000-8000-000000000002 productName "Titan X1 Carbon Wireless Mechanical Keyboard" salePriceCents 12900 originalPriceCents 24900 totalStock 100 startTimeMs <ms> endTimeMs <ms>` and `SET flash_sale:00000000-0000-4000-8000-000000000001:stock <n>`. Choose the times relative to `date +%s%3N` to get `UPCOMING` (start in the future), `ACTIVE` (now inside the window, stock > 0), `SOLD_OUT` (inside the window, stock 0) and `ENDED` (end in the past). Wait 250 ms after each change, then read as `read-<state>`. Remove both keys with `DEL` when done.
- **States (Phase 3.4 on).** Reset through the admin endpoint instead. Active: `.claude/skills/verify/bin/http.sh flash-sale-status reset-active POST /api/v1/admin/flash-sales/reset '{"totalStock":100,"startsOffsetSeconds":-60,"durationSeconds":3600}'`, then read. Upcoming: `'{"startsOffsetSeconds":15,"durationSeconds":3600}'`. Ended: `'{"startsOffsetSeconds":-7200,"durationSeconds":3600}'`. Sold out: drive stock to 0 through checkout (checkout-purchase.md).
- **Proof.** Keep each `read-*.body.json` and the `redis-cli` output. For the banner, run `browser.sh flash-sale-status banner /` and assert the state pill text in the DOM.

## Gotchas

- The status is micro-cached for 200 ms. A reset invalidates the cache, but a direct Redis write does not, so wait 250 ms after hand-seeding. A read racing a reset can still see the old state, so read again after 250 ms before calling it a failure.
- `saleState` is recomputed from the server clock on every request, even from a cached snapshot. Stock can be up to 200 ms stale, but the window boundaries are exact.
- `SOLD_OUT` through the admin reset needs stock driven to 0 by checkout, not `totalStock: 0`, which the database `CHECK` constraints may reject.
