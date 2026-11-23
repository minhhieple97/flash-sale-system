[← README](../README.md)

# Development guide

How to run the system, configure it, try it by hand, and work on the code.

## Prerequisites

| For | You need |
| --- | --- |
| Running the stack | Docker with Compose v2 |
| Working on the code | Node 24 or later, and pnpm 12 (`corepack enable` installs the pinned 12.16.1) |

`.nvmrc` pins Node 24. The root `package.json` declares `devEngines`, so on an older Node `pnpm install` and every `pnpm run` stop with `ERR_PNPM_BAD_RUNTIME_VERSION`. The corepack pnpm is a native binary that runs scripts with the first `node` on `PATH`, so run `nvm use` in each new shell.

## Run everything with Docker

```sh
cp .env.example .env
docker compose up -d --build --wait   # postgres, redis, api, web
curl localhost:3000/health            # {"status":"ok","checks":{"database":"up","redis":"up"}}
open http://localhost:8080            # the storefront
```

| Service | Image | Host port | Starts when |
| --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5432` | Immediately, with a healthcheck |
| `redis` | `redis:7-alpine`, `--appendonly yes` | `127.0.0.1:6379` | Immediately, with a healthcheck |
| `api` | Built from `apps/api/Dockerfile` | `127.0.0.1:3000` | PostgreSQL and Redis are healthy. `restart: unless-stopped` |
| `web` | Vite build, served by `nginx:1.30` | `127.0.0.1:8080` | The API's `/health` passes |
| `k6` | `grafana/k6:1.8.3` | none | Only under the `stress` profile |

Every port binds to `127.0.0.1`. `PORT`, `WEB_PORT`, `POSTGRES_PORT` and `REDIS_PORT` in `.env` change them. If another stack on your machine holds a port, change it there. The compose file sets `name: flash-sale`, so every checkout of this repo shares one project, and a second checkout needs its own `COMPOSE_PROJECT_NAME` as well as its own ports.

```sh
docker compose logs -f api            # quiet by design: warnings and errors, not each request
docker compose down                   # stop, keep the data
docker compose down -v                # stop and delete the PostgreSQL and Redis volumes
```

For multi-replica testing, `docker-compose.scaled.yml` splits stateless HTTP replicas (`APP_ROLE=api`, host port `3000` removed via `ports: !reset []`) from a dedicated `worker` container (`APP_ROLE=worker`):

```sh
docker compose -f docker-compose.yml -f docker-compose.scaled.yml up -d --build --scale api=2 --wait
```

When stopping a scaled stack before `pnpm verify` or Jest integration runs, stop `api`, `worker`, and `web` (`docker compose -f docker-compose.yml -f docker-compose.scaled.yml stop api worker web`), because `worker` shares the same BullMQ queue.

On the first boot the API creates its tables and seeds one product and a sale that opens now, runs 24 hours and holds 100 units. The "Demo scenarios" toolbar at the bottom of the page resets the sale into four states: an active sale with 100 units for an hour, high scarcity with 3 units, a sale that starts in 15 seconds, and one that ended an hour ago.

The API image has two stages. The build stage installs the API's workspace slice with `pnpm install --frozen-lockfile`, compiles, and runs `pnpm deploy --prod` to copy only production dependencies. A BuildKit cache mount keeps the pnpm store between builds. The runtime stage holds `dist` and those dependencies and runs as the `node` user.

## Run the code on the host

```sh
nvm use && corepack enable
cp .env.example .env                  # change POSTGRES_PORT or REDIS_PORT if those ports are taken
docker compose up -d --wait postgres redis
pnpm install
pnpm --filter @flash-sale/api build && pnpm --filter @flash-sale/api start
pnpm --filter @flash-sale/web dev     # http://localhost:5173, proxies /api and /health to 127.0.0.1:3000
```

Set `VITE_API_PROXY_TARGET` when the API runs on another port.

## Configuration

| Variable | Default in `.env.example` | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production`, or `test` (`production` in Compose) |
| `PORT`, `WEB_PORT` | 3000, 8080 | API port and nginx port |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `REDIS_HOST`, `REDIS_PORT` | localhost, 5432, localhost, 6379 | Connections. Compose overrides both hosts and internal container ports (`5432`/`6379`) |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `flash_sale` | PostgreSQL credentials and database |
| `DATABASE_POOL_MAX` | unset (`# 20`) | Optional pool size (`1`–`200`). Defaults to `5` when `APP_ROLE=api` and `20` for `all` or `worker` |
| `APP_ROLE` | `all` | `all` (API + worker + 30 s ticks + 1-strike boot sweep), `api` (HTTP + boot hydration only; no BullMQ worker/consumer queue, ticks, or boot sweep), or `worker` (queue consumer + 30 s ticks + 2-strike boot sweep + `/health` & `/metrics` only) |
| `ENABLE_ADMIN_ENDPOINTS` | true | Turns on the reset route. The code default is false |
| `ADMIN_API_KEY` | unset | Optional shared secret for `POST /api/v1/admin/flash-sales/reset` (`x-admin-key` header) |
| `TRUST_PROXY` | unset (`# false`) | Strict `true`/`false` for Fastify `trustProxy` (used by `RateLimitGuard` via `request.ip`). Code defaults to `false`; Compose defaults `${TRUST_PROXY:-true}` behind nginx's `X-Forwarded-For $remote_addr` |
| `RATE_LIMIT_ENABLED` | false | Enables per-IP in-memory rate limiting on checkout, order-lookup, and admin reset routes (max `50,000` buckets per process) |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | 60000, 60 | Rate-limit window (`1000`–`3600000` ms) and max requests (`1`–`100000`) per IP/route |
| `LOG_LEVEL` | info | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`) |
| `SALE_STARTS_AT`, `SALE_ENDS_AT` | unset | The sale window. Set both or neither. RFC 3339 with `Z` or an offset, for example `2030-01-01T09:00:00+07:00` |
| `SALE_TOTAL_STOCK` | unset | An integer from 1 to 1,000,000 |

The API loads `.env` via `loadDotEnvFiles()` at the top of `bootstrap()` before reading `APP_ROLE` or `TRUST_PROXY`, then validates the environment at boot and refuses to start on a bad value, with a message that names the variable.

How the `SALE_*` variables act:

| Situation | Result |
| --- | --- |
| All unset, first boot | Seeds now, now plus 24 h, and 100 units |
| All unset, later boots | Never moves the stored sale |
| Some set, the stored sale has no order and no ledger entry | Rewrites the parts you set and keeps the stored value of the rest |
| Some set, the stored sale already has an order or a reservation | Keeps the stored sale and logs a warning |

## Try it by hand

These commands need the stack from the first section. The reset route is on because `.env.example` sets `ENABLE_ADMIN_ENDPOINTS=true` (add `-H "x-admin-key: $ADMIN_API_KEY"` if you set `ADMIN_API_KEY`).

```sh
API=localhost:3000/api/v1

# 1. A sale with 3 units, open now for an hour
curl -s -X POST $API/admin/flash-sales/reset -H 'content-type: application/json' \
  -d '{"totalStock":3,"startsOffsetSeconds":0,"durationSeconds":3600}'

# 2. Buy one
curl -s -i -X POST $API/checkout/purchase -H 'content-type: application/json' \
  -d '{"userId":"alice@example.com"}'

# 3. Look the order up: CONFIRMED already, because the worker is fast (RESERVED shows only briefly)
curl -s $API/orders/user/alice@example.com

# 4. The same buyer again, in another spelling: 409 ALREADY_PURCHASED
curl -s -i -X POST $API/checkout/purchase -H 'content-type: application/json' \
  -d '{"userId":"  ALICE@Example.com "}'

# 5. Ten buyers race for the last two units: expect 2 x 202 and 8 x 410
for i in $(seq 1 10); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/checkout/purchase \
    -H 'content-type: application/json' -d "{\"userId\":\"racer-$i\"}" &
done | sort | uniq -c; wait
```

The storefront shows the same things: open two browser tabs, set the "High Scarcity" scenario, and buy from both.

## Commands

| Command | What it does | Needs |
| --- | --- | --- |
| `pnpm --filter @flash-sale/api test:unit` | API unit specs | Nothing |
| `pnpm --filter @flash-sale/api test:integration` | API integration and end-to-end specs | `postgres` and `redis` up, the `api` container stopped |
| `pnpm --filter @flash-sale/api test:e2e` | The HTTP end-to-end specs only | The same |
| `pnpm --filter @flash-sale/web test` | Web specs | Nothing |
| `pnpm test:scripts` | Tests for the architecture check and the stress math | Nothing |
| `pnpm lint` | Biome, then the architecture check | Nothing |
| `pnpm -r typecheck`, `pnpm -r build` | TypeScript and builds | Nothing |
| `pnpm verify` | All of the above in order, one `PASS` or `FAIL` line each | `postgres` and `redis` healthy, `api` and `worker` stopped |
| `pnpm stress:node`, `stress:node:mixed`, `stress:node:pg-blip`, `stress:k6:oversell`, `stress:k6:same-user`, `stress:k6:realistic` | The stress suite (`realistic` runs mixed read+write through nginx at `http://web:80`; the rest target `api:3000` / `BASE_URL` directly) | Running Compose stack (`web` also needed for `realistic` or scaled mode). See [benchmarks.md](benchmarks.md) |

The integration suites share one PostgreSQL, one Redis and one queue name, and Jest runs them one at a time (`maxWorkers: 1`). A running `api` or `worker` container consumes from that queue and fails the suites' jobs, so run `docker compose -f docker-compose.yml -f docker-compose.scaled.yml stop api web worker` first. [testing.md](testing.md) explains the levels.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `ERR_PNPM_BAD_RUNTIME_VERSION` | Node is older than 24. Run `nvm use` |
| `'node:util' does not provide an export named 'styleText'` from Vite or Vitest | Same cause: the shell is on an old Node |
| A port is already in use | Change `PORT`, `WEB_PORT`, `POSTGRES_PORT` or `REDIS_PORT` in `.env` |
| Integration specs fail with jobs that never finish | The `api` container is running. Stop it |
| Integration specs refuse to connect to port 6379 | A client has no connection config. The test setup blocks the default Redis port unless `REDIS_PORT=6379` |
| Two checkouts of this repo collide | They share the compose project `flash-sale`, so one PostgreSQL, one Redis and one queue. Give each its own `COMPOSE_PROJECT_NAME` and ports |
| `502` from nginx for a few seconds after a restart | nginx started before the API resolved. It recovers on its own |

## Repository layout

```text
apps/api/src/
  common/            user id normalizer and pipe, clock, error filter, rate-limit guard
  config/            environment validation (APP_ROLE, ADMIN_API_KEY, TRUST_PROXY, RATE_LIMIT_*, SALE_*)
  infrastructure/    database, redis client options, queue producer
  logging/           pino setup
  modules/
    sale-ledger/     every Redis key, lease, entry format and Lua script
    checkout/        purchase endpoint
    orders/          queue worker, compensation, sweep, order lookup
    flash-sales/     sale status and the sale row
    products/        featured product cache and stale fallback
    admin/           boot heal, maintenance tick, reset
    health/          /health
    metrics/         /metrics Prometheus counters and queue gauge
apps/api/test/       unit, integration, support
apps/web/src/
  app/               shell, layout, error boundary
  shared/            HTTP client, polling hook, Card, Alert
  modules/           product, flash-sale, checkout, orders, simulation
scripts/             arch-check and verify.sh, with their tests
tests/stress/        scenario table, k6 scripts, Node runner
docs/                this documentation
```
