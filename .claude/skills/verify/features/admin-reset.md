# Admin reset and boot hydration

Status: implemented (Phase 3.4). The storefront scenario drawer (`reset-drawer`) is Phase 4.5 and is reported as `not implemented (Phase 4.5)` until it lands.

A reviewer puts the sale into a known scenario with one call, and the API rebuilds its fast state from the database after a cold start. The reset drains the persistence queue, deletes the sale's orders, rewrites the campaign row and the Redis state, and drops the 200 ms status cache, so the next status read is fresh. Boot hydration seeds the sample product and campaign when missing and restores remaining stock as total minus confirmed orders.

## Sub-features

- `reset-apply` answers 200 with the fresh sale status for `{ totalStock?, startsOffsetSeconds?, durationSeconds?, productName? }`; every field is optional and `{}` restores the defaults (100 units, open now for 24 h).
- `reset-validate` answers 400 for an unknown field or an out-of-range value.
- `reset-clears` removes the previous buyers, so a user who bought can buy again.
- `boot-hydrate` rebuilds Redis from PostgreSQL after the Redis keys are lost, then the API restarts.
- `reset-drawer` shows the four scenario presets on the storefront (Phase 4.5).

## How to get to it (user POV)

- `POST http://127.0.0.1:3100/api/v1/admin/flash-sales/reset` with a JSON body.
- Restarting the API process with Redis data missing (hydration runs before the listener opens).
- The scenario drawer at the bottom of the storefront (Phase 4.5).

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold, and `ENABLE_ADMIN_ENDPOINTS` is not `false`.

- **Apply.** Run `.claude/skills/verify/bin/http.sh admin-reset apply POST /api/v1/admin/flash-sales/reset '{"totalStock":3,"startsOffsetSeconds":-60,"durationSeconds":3600,"productName":"Demo Name"}'`. Status 200, `saleState` `ACTIVE`, `totalStock` 3, `remainingStock` 3, `productName` `Demo Name`.
- **Defaults.** Run it with `'{}'` as `defaults`. Status 200, `totalStock` 100, `remainingStock` 100.
- **Validate.** Run it with `'{"totalStock":5,"oops":1}'` as `bad-field` and `'{"totalStock":-1}'` as `bad-stock`. Both are status 400.
- **Clears buyers.** Buy as `alice@example.com` (checkout-purchase.md), reset with `'{}'`, run the lookup for `alice@example.com`. Status 200, `status` `NONE`. Buying again gives 202.
- **Boot hydration.** Buy once as `alice@example.com` and wait until the lookup says `CONFIRMED`. Run `.claude/skills/verify/bin/cleanup.sh`. Delete the three keys with `docker compose exec -T redis redis-cli DEL flash_sale:00000000-0000-4000-8000-000000000001:config flash_sale:00000000-0000-4000-8000-000000000001:stock flash_sale:00000000-0000-4000-8000-000000000001:users`. Run `.claude/skills/verify/bin/launch.sh`. Read `GET /api/v1/flash-sales/current` as `after-boot`: `remainingStock` is 99 of 100. The lookup for alice is still `CONFIRMED` with the same `orderId`, and buying as alice gives 409.
- **Proof.** Keep the response bodies, plus `redis-cli GET flash_sale:00000000-0000-4000-8000-000000000001:stock` and the `psql` order count after the boot-hydration step.

## Gotchas

- A reset is not linearizable with concurrent purchases. Reset before traffic, never during a stress run.
- `productName` changes the sale status only (the Redis config). It does not edit the stored product row, so when Redis later loses its keys, boot hydration shows the stored name again.
- The reset gives every user a clean slate by design: it deletes the sale's orders in PostgreSQL as well as the Redis entries.
- Hydration is a check, then a write, and is not atomic across several API instances. The compose stack runs one instance and hydration finishes before the listener opens, so the window does not open there.
- `cleanup.sh` leaves postgres and redis running, and the API restart alone keeps the Redis state (hydration sees the config and does nothing). That is why the boot-hydration step deletes the three keys by hand first.
