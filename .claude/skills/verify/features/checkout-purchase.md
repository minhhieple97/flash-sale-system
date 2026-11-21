# Checkout purchase

Status: API implemented (Phase 3.3). The storefront form (`buy-form`) is implemented in Phases 4.3 (form and feedback) and 4.4 (confirmation poller).

A shopper enters a user ID and buys the one unit they are allowed. They get a reservation immediately, a clear rejection when they already bought or the sale is sold out, upcoming or ended, and never more than one unit per normalized user.

## Sub-features

- `buy-reserve` returns 202 `{ code: "RESERVED", orderId, userId }` and decrements stock.
- `buy-duplicate` returns 409 `ALREADY_PURCHASED` for the same user, including case and whitespace variants.
- `buy-sold-out` returns 410 `SOLD_OUT` once stock is exhausted.
- `buy-window` returns 422 `SALE_UPCOMING` or `SALE_ENDED` outside the window.
- `buy-invalid` returns 400 `INVALID_USER_ID` for a malformed ID.
- `buy-unavailable` returns 503 `TEMPORARY_FAILURE` when Redis holds no config for the sale, or when Redis or the queue fails.
- `buy-form` is the `Checkout` card: a `User ID` field, a `Random Test User` button and `Buy Now`. `Buy Now` is locked when the sale is not `ACTIVE`, while a request is in flight, or when the field is blank. After a 202 the card polls the order every 400 ms and shows `Order confirmed` with a `Verified receipt`. A 409 shows `Already purchased` and a 410 shows `Sold out`, each with the server message.

## How to get to it (user POV)

- `POST http://127.0.0.1:3100/api/v1/checkout/purchase` with body `{"userId":"<id>"}`.
- The `Buy Now` button in the storefront's `Checkout` card.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.
- Start from a reset: `.claude/skills/verify/bin/http.sh checkout-purchase reset POST /api/v1/admin/flash-sales/reset '{"totalStock":2,"startsOffsetSeconds":-60,"durationSeconds":3600}'`.

- **Reserve.** Run `.claude/skills/verify/bin/http.sh checkout-purchase alice-1 POST /api/v1/checkout/purchase '{"userId":"alice@example.com"}'`. Status 202, `code` `RESERVED`, a UUID `orderId`.
- **Duplicate with a variant.** Run the same with `'{"userId":"  ALICE@example.com "}'` as `alice-2`. Status 409, `code` `ALREADY_PURCHASED`.
- **Sell out.** Buy as `bob@example.com` (202), then as `carol@example.com`. Carol gets 410 `SOLD_OUT`.
- **Side effects.** Check them now, because every later reset deletes the sale's orders. Run `docker compose exec -T redis redis-cli GET flash_sale:00000000-0000-4000-8000-000000000001:stock`, which prints `0`. Run `docker compose exec -T postgres psql -U flash_sale -d flash_sale -tAc "select count(*) from orders where flash_sale_id='00000000-0000-4000-8000-000000000001'"` after the worker drains, which prints `2`.
- **Invalid ID.** Buy with `'{"userId":"a!"}'`. Status 400, `code` `INVALID_USER_ID`.
- **Unavailable.** Run `docker compose exec -T redis redis-cli DEL flash_sale:00000000-0000-4000-8000-000000000001:config`, then buy as `erin@example.com`, naming the call `unavailable`. Status 503, `code` `TEMPORARY_FAILURE`. The next reset restores the config.
- **Window.** Reset with `'{"startsOffsetSeconds":15,"durationSeconds":3600}'`, then buy as `dave@example.com`. Status 422, `code` `SALE_UPCOMING`. Reset with `'{"startsOffsetSeconds":-7200,"durationSeconds":3600}'`, buy again. Status 422, `code` `SALE_ENDED`. The order count is now `0`, because the resets deleted the earlier orders and neither attempt created one.
- **Buy again after a reset.** Reset with `'{}'`, then buy as `alice@example.com`, naming the call `alice-again`. Status 202 with a new `orderId`, and the lookup shows it `CONFIRMED` once the worker drains. Redis stock is `99` and the order count is `1`.
- **Form.** Apply `High Scarcity` from the drawer (admin-reset.md, 3 units). Run `.claude/skills/verify/bin/ui.sh checkout-purchase buy-confirmed '[{"goto":"/"},{"fill":{"label":"User ID","value":"alice@example.com","in":"Checkout"}},{"click":{"name":"Buy Now","in":"Checkout"}},{"expect":{"text":"Order confirmed","in":"Checkout"}},{"expect":{"text":"Verified receipt","in":"Checkout"}}]'`. Repeat with `"  ALICE@example.com "` as `buy-duplicate`, expecting `Already purchased` and `This user already holds a unit from this sale`. Click `Random Test User` then `Buy Now` as `buy-random`, expecting `Verified receipt`. Buy as `bob@example.com` as `buy-sold-out`, then expect `Sold out` (exact) and `0 of 3 left` in `Sale status` within 5 s, `Buy Now` disabled, and `This sale is sold out.` in `Checkout`.
- **Form side effects.** The lookup for `alice@example.com` is `CONFIRMED` with the receipt's order id, `redis-cli GET flash_sale:00000000-0000-4000-8000-000000000001:stock` prints `0`, and the Postgres order count prints `3`.
- **Proof.** Keep every `*.body.json` plus the side-effect outputs, saved into the feature's evidence dir, and the `buy-*` step logs and screenshots.

## Gotchas

- Orders persist asynchronously through BullMQ. Poll the Postgres count for a few seconds before calling it missing.
- Concurrency is proven by the e2e suite and `tests/stress`, not by this journey. Do not fire parallel buys here.
- Redis's host port is the `REDIS_PORT` of the root `.env`, which differs per machine. `docker compose exec` avoids caring about it.
- The form cannot reliably produce a 410 or 422, because `Buy Now` locks as soon as the 2 s poll reports `SOLD_OUT`, `UPCOMING` or `ENDED`. Only a click that beats the poll reaches those codes. `CheckoutFormCard.spec.tsx` covers their banners, and the API steps above cover the statuses.
