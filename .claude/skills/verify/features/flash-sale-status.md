# Flash sale status

Status: implemented (read path Phase 2.4, boot hydration and admin reset Phase 3.4). Boot hydration seeds the sale, so a freshly booted API answers 200. The banner (`status-banner`) is Phase 4.2 and is reported as `not implemented (Phase 4.2)` until it lands.

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
- The admin endpoint is enabled (`ENABLE_ADMIN_ENDPOINTS=true`, the default).

- **Missing.** After boot, delete the key (`docker compose exec -T redis redis-cli DEL flash_sale:00000000-0000-4000-8000-000000000001:config`) and wait 250 ms. With no `flash_sale:00000000-0000-4000-8000-000000000001:config` key in Redis, run `.claude/skills/verify/bin/http.sh flash-sale-status missing GET /api/v1/flash-sales/current`. Status 404, `code` `FLASH_SALE_NOT_FOUND`.
- **States.** Reset through the admin endpoint. Active: `.claude/skills/verify/bin/http.sh flash-sale-status reset-active POST /api/v1/admin/flash-sales/reset '{"totalStock":100,"startsOffsetSeconds":-60,"durationSeconds":3600}'`, then read. Upcoming: `'{"startsOffsetSeconds":15,"durationSeconds":3600}'`. Ended: `'{"startsOffsetSeconds":-7200,"durationSeconds":3600}'`. Sold out: `'{"totalStock":0}'`, or drive stock to 0 through checkout (checkout-purchase.md).
- **Proof.** Keep each `read-*.body.json` and the `redis-cli` output. For the banner, run `browser.sh flash-sale-status banner /` and assert the state pill text in the DOM.

## Gotchas

- The status is micro-cached for 200 ms. A reset invalidates the cache, but a direct Redis write does not, so wait 250 ms after hand-seeding. A read racing a reset can still see the old state, so read again after 250 ms before calling it a failure.
- `saleState` is recomputed from the server clock on every request, even from a cached snapshot. Stock can be up to 200 ms stale, but the window boundaries are exact.
- `{"totalStock":0}` is accepted by the admin reset and the database `CHECK` constraints. It answers 200 `SOLD_OUT` with `remainingStock` 0, and a purchase then answers 410 (driven in run 20261120-182128).
- After deleting the Redis config key, restore the sale with an admin reset, or restart the API, whose boot hydration rebuilds Redis from PostgreSQL (see admin-reset.md).
