# Order lookup

Status: API implemented (Phase 3.2). The storefront card and the confirmation poller (`lookup-card`) are implemented in Phase 4.4.

A shopper checks whether they hold an order. Until the worker persists the order they see `RESERVED`, then `CONFIRMED` with the same order ID. The worker usually finishes within milliseconds, so the first lookup after a purchase normally already shows `CONFIRMED`. A user who never bought sees `NONE`.

## Sub-features

- `lookup-none` returns `hasPurchased: false`, `status: "NONE"`, `orderId: null`.
- `lookup-confirmed` returns `CONFIRMED` with the `orderId` from the purchase response.
- `lookup-normalized` finds the same order for case and whitespace variants of the user ID.
- `lookup-card` is the `Order lookup` card: a `User ID` field and `Check order`. `CONFIRMED` shows `Order confirmed` with a `Verified receipt`, `RESERVED` shows `Reserved, awaiting confirmation`, `NONE` shows `No order found for <id>`, and an error shows `Lookup failed` with the API message.

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/api/v1/orders/user/<userId>`.
- The `Order lookup` card on the storefront, and the confirmation poller inside the `Checkout` card after a purchase.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.
- `alice@example.com` holds the order from its latest purchase since the last reset, and that purchase's body is in `.verify-evidence/<run-id>/checkout-purchase/`. After the full checkout-purchase journey it is `alice-again.body.json`, because the journey's resets delete the `alice-1` order.

- **Never bought.** Run `.claude/skills/verify/bin/http.sh order-lookup nobody GET /api/v1/orders/user/nobody@example.com`. Status 200, `status` `NONE`, `orderId` `null`.
- **Confirmed.** Poll `.claude/skills/verify/bin/http.sh order-lookup alice GET /api/v1/orders/user/alice@example.com` until `status` is `CONFIRMED` (at most 10 s). The `orderId` equals the one in that purchase body.
- **Normalized.** Run it with `ALICE@Example.com` as `alice-upper`. Same `orderId`.
- **Invalid.** Run `.claude/skills/verify/bin/http.sh order-lookup invalid GET '/api/v1/orders/user/a!'`. Status 400, `code` `INVALID_USER_ID`.
- **Card.** After the checkout form journey, run `.claude/skills/verify/bin/ui.sh order-lookup lookup-confirmed '[{"goto":"/"},{"fill":{"label":"User ID","value":"ALICE@Example.com","in":"Order lookup"}},{"click":{"name":"Check order","in":"Order lookup"}},{"expect":{"text":"Order confirmed","in":"Order lookup"}},{"expect":{"text":"Verified receipt","in":"Order lookup"}}]'`. Repeat with `nobody@example.com` as `lookup-none`, expecting `No order found for nobody@example.com`, and with `a!` as `lookup-invalid`, expecting `Lookup failed`.
- **Proof.** Keep `nobody`, `alice`, `alice-upper` and `invalid` bodies, quote the matching order IDs, and keep the `lookup-*` step logs and screenshots.

## Gotchas

- `RESERVED` is a legitimate intermediate state. A lookup that never reaches `CONFIRMED` within 10 s is a failure of persistence, not of lookup. Check the API log for worker errors.
- Path segments with `@` or `+` must be passed literally. Do not URL-encode them twice.
