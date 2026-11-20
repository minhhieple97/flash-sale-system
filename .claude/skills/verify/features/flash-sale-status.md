# Flash sale status

Status: planned (Phase 2.4). Until it lands, `GET /api/v1/flash-sales/current` returns 404 and this journey is reported as `not implemented (Phase 2.4)`.

A shopper sees whether the sale is upcoming, active, sold out or ended, with remaining stock and a countdown that is correct even when the shopper's clock is wrong.

## Sub-features

- `status-read` returns `saleState`, `totalStock`, `remainingStock`, `startsAt`, `endsAt` and `serverTime`.
- `status-states` covers `UPCOMING`, `ACTIVE`, `SOLD_OUT` and `ENDED`, each reachable through the admin reset.
- `status-banner` shows the state pill, countdown and stock bar on the storefront (Phase 4.2).

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/flash-sales/current`.
- The sale banner on the storefront at `/` (Phase 4.2).

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.
- The admin endpoint is enabled (`ENABLE_ADMIN_ENDPOINTS=true`, the default).

- **Active sale.** Run `.claude/skills/verify/bin/http.sh flash-sale-status reset-active POST /api/v1/admin/flash-sales/reset '{"totalStock":100,"startsOffsetSeconds":-60,"durationSeconds":3600}'`, then `.claude/skills/verify/bin/http.sh flash-sale-status read-active GET /api/v1/flash-sales/current`. Status 200, `saleState` `ACTIVE`, `remainingStock` 100.
- **Upcoming sale.** Reset with `'{"startsOffsetSeconds":15,"durationSeconds":3600}'`, then read. `saleState` `UPCOMING`, with `startsAt` after `serverTime`.
- **Ended sale.** Reset with `'{"startsOffsetSeconds":-7200,"durationSeconds":3600}'`, then read. `saleState` `ENDED`.
- **Proof.** Keep each `read-*.body.json`. For the banner, run `browser.sh flash-sale-status banner /` and assert the state pill text in the DOM.

## Gotchas

- The status is micro-cached for 200 ms. A reset invalidates the cache, but a read racing a reset can still see the old state. Read again after 250 ms before calling it a failure.
- `SOLD_OUT` needs stock driven to 0 through checkout (see checkout-purchase.md), not a reset with `totalStock: 0`, which may be rejected by the database `CHECK` constraints.
