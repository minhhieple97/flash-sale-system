# Flash-sale verification map

This directory is the maintained source for verifying the user-facing behavior of the flash-sale system. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `.claude/skills/verify/bin/launch.sh` printed `READY`, giving an API at `http://127.0.0.1:3100` and a web at `http://127.0.0.1:5180` unless `VERIFY_API_PORT` / `VERIFY_WEB_PORT` override them.
- `.claude/skills/verify/bin/doctor.sh` exits 0.
- Never drive an instance this verification run did not start.

## Driving conventions

- API actions go through `.claude/skills/verify/bin/http.sh <feature> <name> <METHOD> <path> [json-body]`.
- Page proofs go through `.claude/skills/verify/bin/browser.sh <feature> <name> <path>`, and storefront interactions through `.claude/skills/verify/bin/ui.sh <feature> <name> '<steps-json>'` (SKILL.md lists the step vocabulary).
- Prefer ARIA roles and accessible names (`heading "Flash Sale"`) over CSS classes.
- Treat paths, user IDs and JSON bodies as literal.
- Mutating journeys start by resetting the sale through the admin endpoint (once it exists), not by editing Redis or Postgres by hand.

## Proof and skip reporting

- API proof is the request, the status, the headers and the body, all written by `http.sh`.
- UI proof is the rendered DOM plus a screenshot, written by `browser.sh`, and for interactions the `ui.sh` step log as well.
- Mutation proof includes a second read-only view of the stored state.
- Record the feature ID and entry point used with every artifact.
- A planned feature that is not implemented yet is reported as `not implemented (Phase N)`, never as passing.

## Feature entry contract

Each feature file starts with an H1 title, a status line, and one paragraph describing the user-visible behavior. It then has exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify/bin`, `Gotchas`.

## Features

Implemented (Phases 1 to 6):
- [Storefront shell](./storefront-shell.md) covers the web page loading, React rendering the app heading, the composed storefront, and the card error states when the API is down.
- [API HTTP surface](./api-http-surface.md) covers the `/api/v1` prefix and the `{ code, message }` error body.
- [Health](./health.md) covers `GET /health` with its Postgres and Redis checks.
- [Featured product](./products-featured.md) covers `GET /api/v1/products/featured`.
- [Flash sale status](./flash-sale-status.md) covers `GET /api/v1/flash-sales/current` and its four states, set through the admin reset.
- [Checkout purchase](./checkout-purchase.md) covers `POST /api/v1/checkout/purchase`: reserve, duplicate, sold out, window, invalid id and unavailable.
- [Order lookup](./order-lookup.md) covers `GET /api/v1/orders/user/:userId`: none, reserved and confirmed.
- [Admin reset and boot hydration](./admin-reset.md) covers `POST /api/v1/admin/flash-sales/reset` and the Redis rebuild from PostgreSQL after a cold start.
- [Containerized stack](./docker-stack.md) covers `docker compose up -d --build`, the API on its published port, and the nginx web container with its `/api` proxy.
- [Stress suite](./stress-suite.md) covers the two k6 scripts and the Node runner with its PostgreSQL and Redis checks.

Each API feature file also carries its storefront sub-feature, driven with `ui.sh`: `product-card` (Phase 4.1), `status-banner` (4.2), `buy-form` (4.3 and 4.4), `lookup-card` (4.4) and `reset-drawer` (4.5).
