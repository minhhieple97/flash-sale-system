# Order lookup

Status: planned (Phase 3.2). Until it lands, `GET /api/v1/orders/user/:userId` returns 404 and this journey is reported as `not implemented (Phase 3.2)`.

A shopper checks whether they hold an order. Right after buying they see `RESERVED`, and once the order is persisted they see `CONFIRMED` with the same order ID. A user who never bought sees `NONE`.

## Sub-features

- `lookup-none` returns `hasPurchased: false`, `status: "NONE"`, `orderId: null`.
- `lookup-confirmed` returns `CONFIRMED` with the `orderId` from the purchase response.
- `lookup-normalized` finds the same order for case and whitespace variants of the user ID.
- `lookup-card` shows the receipt in the storefront order lookup card (Phase 4.4).

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/orders/user/<userId>`.
- The order lookup card on the storefront, and the automatic confirmation poller after a purchase (Phase 4.4).

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.
- `alice@example.com` bought one unit (checkout-purchase.md `Reserve`), and its `orderId` is in `.verify-evidence/<run-id>/checkout-purchase/alice-1.body.json`.

- **Never bought.** Run `.claude/skills/verify/bin/http.sh order-lookup nobody GET /api/v1/orders/user/nobody@example.com`. Status 200, `status` `NONE`, `orderId` `null`.
- **Confirmed.** Poll `.claude/skills/verify/bin/http.sh order-lookup alice GET /api/v1/orders/user/alice@example.com` until `status` is `CONFIRMED` (at most 10 s). The `orderId` equals the one from `alice-1.body.json`.
- **Normalized.** Run it with `ALICE@Example.com` as `alice-upper`. Same `orderId`.
- **Proof.** Keep `nobody`, `alice` and `alice-upper` bodies, and quote the matching order IDs.

## Gotchas

- `RESERVED` is a legitimate intermediate state. A lookup that never reaches `CONFIRMED` within 10 s is a failure of persistence, not of lookup. Check the API log for worker errors.
- Path segments with `@` or `+` must be passed literally. Do not URL-encode them twice.
