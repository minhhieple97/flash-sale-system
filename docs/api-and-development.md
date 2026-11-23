[← README](../README.md)

# HTTP API, Development & Testing Guide

Complete HTTP contract, local setup, configuration reference, testing pyramid, and troubleshooting.

## 1. HTTP API Reference

All endpoints live under `/api/v1` except `/health` and `/metrics`. Fastify enforces a `16 KiB` JSON body limit and emits `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer` on every API response. nginx proxies `/api/` and exact `/health` on port `8080` (keeping `/metrics` internal on port `3000` and adding `Content-Security-Policy` on static SPA responses) so the browser uses relative URLs with no CORS needed.

| Method | Path | Purpose & Cache Policy |
| --- | --- | --- |
| `GET` | `/health` | `200` when PostgreSQL & Redis answer within `1 s`, else `503` |
| `GET` | `/metrics` | Internal Prometheus text counters & BullMQ queue depth gauge (port `3000` only) |
| `GET` | `/api/v1/products/featured` | Featured product (`60 s` singleflight cache; `Cache-Control: public, max-age=60, stale-while-revalidate=300`) |
| `GET` | `/api/v1/flash-sales/current` | Sale state (`UPCOMING`/`ACTIVE`/`SOLD_OUT`/`ENDED`), stock, window, `serverTime` (`Cache-Control: no-store`) |
| `POST` | `/api/v1/checkout/purchase` | Reserve 1 unit (`202`) or typed refusal; optional `RateLimitGuard` |
| `GET` | `/api/v1/orders/user/:userId` | Buyer status (`NONE`/`RESERVED`/`CONFIRMED`) + `orderId` (`Cache-Control: no-store`); optional `RateLimitGuard` |
| `POST` | `/api/v1/admin/flash-sales/reset` | Demo/test reset (`ENABLE_ADMIN_ENDPOINTS=true`, optional `x-admin-key`, requires `Content-Type: application/json`) |

### Error Envelope & Status Codes

All API errors return `{ "code": "<STABLE_CODE>", "message": "<human-readable detail>" }`:

| Status | `code` | Trigger |
| --- | --- | --- |
| `400` | `INVALID_USER_ID` / `BAD_REQUEST` | `userId` fails `^[a-z0-9._@+-]{3,128}$` (after trim + lowercase), or invalid reset payload |
| `401` | `UNAUTHORIZED` | `ADMIN_API_KEY` is configured and `x-admin-key` is missing or invalid |
| `404` | `NOT_FOUND` / `FLASH_SALE_NOT_FOUND` / `PRODUCT_NOT_FOUND` | Unknown route, disabled admin route, or missing campaign/product row |
| `409` | `ALREADY_PURCHASED` | Buyer already holds a `RESERVED` or `CONFIRMED` unit |
| `410` | `SOLD_OUT` | Remaining stock is `0` |
| `413` | `PAYLOAD_TOO_LARGE` | Request body exceeds `16 KiB` |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | `POST /api/v1/admin/flash-sales/reset` without `Content-Type: application/json` |
| `422` | `SALE_UPCOMING` / `SALE_ENDED` | Request outside inclusive `[startsAt, endsAt]` window |
| `429` | `RATE_LIMITED` | Per-IP rate limit exceeded (`RATE_LIMIT_ENABLED=true`, includes `Retry-After`) |
| `503` | `TEMPORARY_FAILURE` | Redis/PostgreSQL/queue fault, missing stock key, or reset lock/drain timeout |
| `500` | `INTERNAL_ERROR` | Unexpected failure (details logged server-side only) |

### Key Endpoint Contracts

**`GET /health`** — `200` (or `503` with `status: "error"` and failing check `"down"`):
```json
{ "status": "ok", "checks": { "database": "up", "redis": "up" } }
```

**`GET /metrics`** — Prometheus text (`text/plain; version=0.0.4`) exposing `flash_sale_purchase_attempts_total{outcome}`, `flash_sale_order_persistence_total{outcome}`, and `flash_sale_order_queue_jobs{state}`.

**`GET /api/v1/products/featured`** — `200` (prices in integer cents):
```json
{
  "id": "00000000-0000-4000-8000-000000000002",
  "sku": "TITAN-X1-LE",
  "name": "Titan X1 Carbon Wireless Mechanical Keyboard",
  "description": "Limited-edition carbon-fiber wireless mechanical keyboard. Limit 1 per customer.",
  "originalPriceCents": 24900,
  "salePriceCents": 12900,
  "imageUrl": null
}
```

**`GET /api/v1/flash-sales/current`** — `200` (`FOUND` snapshot cached 200 ms; `serverTime` & `saleState` always computed live; checks PG on `NOT_CONFIGURED` so missing Redis keys return `503` instead of a false `404`):
```json
{
  "saleId": "00000000-0000-4000-8000-000000000001",
  "saleState": "ACTIVE",
  "totalStock": 100,
  "remainingStock": 100,
  "startsAt": "2026-11-23T02:00:00.000Z",
  "endsAt": "2026-11-24T02:00:00.000Z",
  "serverTime": "2026-11-23T02:05:12.401Z"
}
```

**`POST /api/v1/checkout/purchase`** — Body `{ "userId": "alice@example.com" }`:
- `202 RESERVED`:
  ```json
  {
    "code": "RESERVED",
    "orderId": "cf353d1d-637c-460c-8f4d-4edc52b6227d",
    "userId": "alice@example.com",
    "message": "Your unit is reserved; the order is being confirmed"
  }
  ```
- Note: `202` is a durable reservation promise; poll `GET /api/v1/orders/user/:userId` to observe `CONFIRMED`. After a `503`, check order status before retrying.

**`GET /api/v1/orders/user/:userId`** — `200` (answered directly from Redis when intact; falls back to PG only when ledger keys are missing):
```json
{
  "userId": "alice@example.com",
  "hasPurchased": true,
  "status": "CONFIRMED",
  "orderId": "cf353d1d-637c-460c-8f4d-4edc52b6227d"
}
```
(`status` is `NONE` with `hasPurchased: false, orderId: null` when the user holds no unit.)

**`POST /api/v1/admin/flash-sales/reset`** — All body fields optional (`{}` restores configured defaults; unknown fields return `400`; `startsAt`/`endsAt` are zoned RFC 3339 timestamps and cannot mix with `startsOffsetSeconds`/`durationSeconds`):
```sh
curl -X POST http://localhost:3000/api/v1/admin/flash-sales/reset \
  -H 'content-type: application/json' \
  -d '{"totalStock":3,"startsOffsetSeconds":0,"durationSeconds":3600}'
```
Returns the new `GET /api/v1/flash-sales/current` payload.

## 2. Local Setup & Configuration

### Run With Docker Compose (Recommended)

Requires Docker with Compose v2. Every port binds to `127.0.0.1`.

```sh
cp .env.example .env
docker compose up -d --build --wait   # postgres, redis, api, web
curl http://localhost:3000/health     # {"status":"ok","checks":{"database":"up","redis":"up"}}
# Open http://localhost:8080 (use "Demo scenarios" drawer to switch stock/windows)
```

### Run on Host (Development)

Requires **Node >= 24** (`.nvmrc`; enforced by `devEngines`) and **pnpm 12** (`corepack enable`).

```sh
nvm use && corepack enable
cp .env.example .env
docker compose up -d --wait postgres redis
pnpm install
pnpm --filter @flash-sale/api build && pnpm --filter @flash-sale/api start
pnpm --filter @flash-sale/web dev     # http://localhost:5173 (proxies /api & /health to :3000)
```

### Environment Variables

The API loads `.env` via Node 24 `util.parseEnv` (`load-dotenv.util.ts`) and validates all values at boot, failing fast with the offending variable name.

| Variable | `.env.example` Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production`, or `test` (`production` in Compose) |
| `PORT`, `WEB_PORT` | `3000`, `8080` | API listen port and nginx published port |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `localhost`, `5432`, `flash_sale` | PostgreSQL connection (Compose overrides host/port internally) |
| `DATABASE_POOL_MAX` | unset (`20`) | Optional PG pool size (`1`–`200`, default `20`) |
| `REDIS_HOST`, `REDIS_PORT` | `localhost`, `6379` | Redis connection |
| `ENABLE_ADMIN_ENDPOINTS` | `true` | Enables `/api/v1/admin/flash-sales/reset` (code default is `false`; warns on boot if `true` without `ADMIN_API_KEY` in `production`) |
| `ADMIN_API_KEY` | unset | Optional shared secret checked via constant-time comparison on `x-admin-key` |
| `TRUST_PROXY` | unset (`false`) | Fastify `trustProxy` for `request.ip`; Compose defaults `${TRUST_PROXY:-true}` behind nginx |
| `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | `false`, `60000`, `60` | Optional in-memory per-IP limiter (max 50,000 buckets) on checkout, lookup, and reset |
| `LOG_LEVEL` | `info` | Pino level (`fatal`..`trace`, `silent`); hot routes are excluded from info logs |
| `SALE_STARTS_AT`, `SALE_ENDS_AT`, `SALE_TOTAL_STOCK` | unset | Optional RFC 3339 zoned window (set both or neither) and stock (`1`–`1,000,000`). Rewrites stored sale on boot only if no orders/reservations exist; otherwise logs a warning and preserves live state |

### Quick `curl` Walkthrough

```sh
API=http://localhost:3000/api/v1
curl -s -X POST "$API/admin/flash-sales/reset" -H 'content-type: application/json' \
  -d '{"totalStock":3,"startsOffsetSeconds":0,"durationSeconds":3600}'
curl -s -i -X POST "$API/checkout/purchase" -H 'content-type: application/json' -d '{"userId":"alice@example.com"}'
curl -s "$API/orders/user/alice@example.com"
curl -s -i -X POST "$API/checkout/purchase" -H 'content-type: application/json' -d '{"userId":"  ALICE@Example.com "}' # 409
for i in $(seq 1 10); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/checkout/purchase" \
    -H 'content-type: application/json' -d "{\"userId\":\"racer-$i\"}" &
done | sort | uniq -c; wait   # Expect 2 x 202, 8 x 410
```

## 3. Testing, Static Checks, and Verification

Each invariant is tested at the lowest layer that genuinely proves it: pure branching and clock boundaries in unit tests, real Redis Lua scripts / BullMQ / PostgreSQL constraints in integration tests, full HTTP race tests in E2E, and multi-hundred-VU concurrency in stress suites.

| Level | Command | Target / Scope | Coverage |
| --- | --- | --- | --- |
| **API Unit** | `pnpm --filter @flash-sale/api test:unit` | `apps/api/test/unit/` (pinned `ClockService`, Fastify HTTP/guard specs, `sale-ledger` boundary spec) | 52 files, 485 tests |
| **API Integration & E2E** | `pnpm --filter @flash-sale/api test:integration` | `apps/api/test/integration/` (real PostgreSQL 16, Redis 7, BullMQ; `maxWorkers: 1`, `--detectOpenHandles`) | 32 files (28 integration + 4 E2E), 197 tests |
| **Web (Vitest + RTL)** | `pnpm --filter @flash-sale/web test` | `apps/web/src/**/__tests__/` (real hooks/components, fake timers, stubbed `fetch` only) | 21 files, 214 tests |
| **Stress Math** | `pnpm test:scripts` | `scripts/stress-math.test.mjs` (`node --test`) | 1 file (10 suites), 19 tests |
| **Static Checks** | `pnpm lint && pnpm -r typecheck` | Biome (`--error-on-warnings`, `noExplicitAny`, `noConsole`, cognitive complexity <= 10) + TypeScript 6 `strict` | 0 warnings / 0 errors |
| **Full Verification Gate** | `pnpm verify` | 9 gates: PG & Redis healthy → lint → script tests → typecheck → `api` stopped → Jest `--detectOpenHandles` → Vitest → workspace build | Automated + GitHub Actions CI |

### What Integration & E2E Tests Prove
- **Concurrency & boundaries:** 100 parallel users fighting for 10 units (`10 × 202`, `90 × 410`, 10 PG rows, `remaining_stock = 0`); 50 case/whitespace variants of one user (`1 × 202`, `49 × 409`); exact edges `startsAt - 1`, `startsAt`, `endsAt`, `endsAt + 1`.
- **Lua idempotency & CAS fences:** Every script in `SALE_LEDGER_SCRIPTS` resent without mutating state twice; released reservations never resurrect as `CONFIRMED`.
- **Pipeline & self-healing:** Real BullMQ retries, PG-first compensation, `adoptOrder` (including mid-restore retry), stateless `ZSET` orphan sweeping (grace window + boot sweep), `FLUSHALL` 1,000-row chunked hydration under `maintenance_lock`, partial reset recovery, and clean `SIGTERM` shutdown order.
- **Post-test ledger convergence:** `expectLedgerConverged` runs after pipeline integration tests to prove zero jobless `RESERVED` slots and `stock + HLEN(users) === totalStock`.
- **Security & ops E2E (`ops-security.e2e-spec.ts`):** `ADMIN_API_KEY` (`401`/`415`/`200`), `RATE_LIMIT_ENABLED` (`429` + `retry-after`), and Prometheus `/metrics` output.

### Troubleshooting

| Symptom | Cause & Fix |
| --- | --- |
| `ERR_PNPM_BAD_RUNTIME_VERSION` or Vite `styleText` error | Shell is using Node < 24. Run `nvm use` |
| Integration jobs hang / fail unexpectedly | The compose `api` container is running and consuming the shared BullMQ queue. Run `docker compose stop api web` before `pnpm verify` |
| Port conflict (`3000`, `8080`, `5432`, `6379`) | Override `PORT`, `WEB_PORT`, `POSTGRES_PORT`, or `REDIS_PORT` in `.env` |
| `502` from nginx right after API restart | nginx started before upstream DNS resolved; recovers automatically within 10 s |
