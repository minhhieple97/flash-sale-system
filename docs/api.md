[← README](../README.md)

# HTTP API

Every example below is a real response from the running stack. All routes except `/health` and `/metrics` live under `/api/v1`. Bodies are JSON except `/metrics`, which returns Prometheus text, and Fastify attaches `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer` on every response (with a `16 KiB` JSON body limit). Buyer routes have no user authentication, so the user id is a plain identifier ([design-decisions.md](design-decisions.md#15-optional-rate-limiting-and-admin-key-no-buyer-auth) says why); `RATE_LIMIT_ENABLED` optionally enables per-IP rate limiting (keyed on `request.ip` governed by `TRUST_PROXY`) and `ADMIN_API_KEY` optionally protects the reset route. Through nginx `/api/` and exact `/health` work on the web port (`/metrics` stays internal on port 3000 — requesting `:8080/metrics` falls through to nginx's SPA `index.html`), so the browser uses relative URLs and the API needs no CORS.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness of PostgreSQL and Redis |
| `GET` | `/metrics` | Internal Prometheus counters and BullMQ queue gauges (internal port `3000`, not proxied by nginx; unpublished on host in `docker-compose.scaled.yml`) |
| `GET` | `/api/v1/products/featured` | The product on sale (60 s singleflight cache, `Cache-Control: public, max-age=60, stale-while-revalidate=300`) |
| `GET` | `/api/v1/flash-sales/current` | Sale state, stock, window and server time |
| `POST` | `/api/v1/checkout/purchase` | Try to buy one unit |
| `GET` | `/api/v1/orders/user/:userId` | Whether a buyer holds a unit |
| `POST` | `/api/v1/admin/flash-sales/reset` | Demo tool: reset the sale |

## Errors

Every API error response normalized by `GlobalExceptionFilter` has the same two fields (`code` and `message`). `code` is stable and meant for programs. `message` is for people and may change.

```json
{ "code": "INVALID_USER_ID", "message": "userId must be 3-128 characters of a-z, 0-9, \".\", \"_\", \"@\", \"+\" or \"-\"" }
```

| `code` | Status | When |
| --- | --- | --- |
| `INVALID_USER_ID` | 400 | The user id is missing, not a string, or not 3 to 128 characters of `a-z 0-9 . _ @ + -` after trimming and lowercasing |
| `BAD_REQUEST` | 400 | A reset body fails validation. The message names the problem |
| `UNAUTHORIZED` | 401 | `ADMIN_API_KEY` is configured and the `x-admin-key` header is missing or does not match |
| `NOT_FOUND` | 404 | An unknown route, or the reset route while `ENABLE_ADMIN_ENDPOINTS` is false |
| `FLASH_SALE_NOT_FOUND` | 404 | Redis holds no config for the sale. The tick restores it |
| `PRODUCT_NOT_FOUND` | 404 | The product row is missing |
| `ALREADY_PURCHASED` | 409 | The buyer already holds a unit |
| `SOLD_OUT` | 410 | No stock is left |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeds the `16 KiB` Fastify `bodyLimit` |
| `SALE_UPCOMING`, `SALE_ENDED` | 422 | The request is outside the sale window |
| `RATE_LIMITED` | 429 | Per-IP rate limit exceeded on checkout or order lookup when `RATE_LIMIT_ENABLED=true` |
| `TEMPORARY_FAILURE` | 503 | Redis, PostgreSQL (during fallback/health/reset), or the queue failed, the stock key is missing, or a reset could not acquire `maintenance_lock` (2 s) or waited out in-flight jobs (10 s). Safe to try again later |
| `INTERNAL_ERROR` | 500 | Anything else. The detail goes to the log and never to the client |

## `GET /health`

Answers 200 when PostgreSQL and Redis both answer within 1 s, and 503 otherwise. The body is not an error body, and shows which one is down.

```json
{ "status": "ok", "checks": { "database": "up", "redis": "up" } }
```

On failure the status is `error` and the failing check reads `down`. Compose uses this route as the API's healthcheck. It turns green only after boot heal has finished.

## `GET /metrics`

Internal Prometheus text endpoint (`Content-Type: text/plain; version=0.0.4; charset=utf-8`), served on port `3000` by every process (`all`, `api`, `worker`) and intentionally not proxied by nginx (`:8080/metrics` serves `index.html`, and `docker-compose.scaled.yml` removes host port `3000` so metrics stay inside the Docker network). In split mode, each `api` replica increments purchase attempts and `worker` increments persistence outcomes; both expose the queue gauge. Exports:

- `flash_sale_purchase_attempts_total{outcome="..."}`: purchase outcomes (`RESERVED`, `ALREADY_PURCHASED`, `SOLD_OUT`, `SALE_UPCOMING`, `SALE_ENDED`, `TEMPORARY_FAILURE`).
- `flash_sale_order_persistence_total{outcome="..."}`: worker/compensation outcomes (`INSERTED`, `ALREADY_PERSISTED`, `STALE`, `CONFIRMED`, `RELEASED`, `NOT_RESERVED`, `FAILED`).
- `flash_sale_order_queue_jobs{state="waiting|active|delayed|failed"}`: live BullMQ job counts.

## `GET /api/v1/products/featured`

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

Prices are integers in cents, so no float rounding. `ProductsService` caches the product in memory for 60 s with singleflight coalescing (concurrent cache misses share one PostgreSQL read), emits `Cache-Control: public, max-age=60, stale-while-revalidate=300`, and serves its last known copy if PostgreSQL is temporarily unavailable. Redis holds only what the purchase gate needs.

## `GET /api/v1/flash-sales/current`

```json
{
  "saleId": "00000000-0000-4000-8000-000000000001",
  "saleState": "ACTIVE",
  "totalStock": 100,
  "remainingStock": 100,
  "startsAt": "2026-11-22T07:25:34.622Z",
  "endsAt": "2026-11-23T07:25:34.622Z",
  "serverTime": "2026-11-22T07:28:08.999Z"
}
```

| Field | Meaning |
| --- | --- |
| `saleState` | `UPCOMING` before `startsAt`, `ENDED` after `endsAt`, `SOLD_OUT` when stock is 0, otherwise `ACTIVE`. Checked in that order |
| `remainingStock` | Units not yet reserved or sold. It drops at the reservation, not at the order |
| `serverTime` | The API's clock when it computed the answer. Clients should count from it and not from their own clock |

Only the Redis snapshot (`saleId`, `totalStock`, `remainingStock`, `startsAtMs`, `endsAtMs`) is micro-cached in the API for 200 ms; `serverTime` and `saleState` are computed fresh from `ClockService` on every request, so `serverTime` is current and window transitions happen immediately. Answers 404 `FLASH_SALE_NOT_FOUND` when Redis holds no config, and 503 `TEMPORARY_FAILURE` when the config exists but the stock key is missing.

## `POST /api/v1/checkout/purchase`

Request:

```json
{ "userId": "alice@example.com" }
```

The user id is trimmed and lowercased, so `"  ALICE@Example.com "` is the same buyer.

| Status | `code` | Body | Meaning |
| --- | --- | --- | --- |
| 202 | `RESERVED` | `code`, `orderId`, `userId`, `message` | A unit is reserved and the order is being written |
| 409 | `ALREADY_PURCHASED` | `code`, `message` | This buyer already holds a unit |
| 410 | `SOLD_OUT` | `code`, `message` | No stock is left |
| 422 | `SALE_UPCOMING` | `code`, `message` | The sale has not started |
| 422 | `SALE_ENDED` | `code`, `message` | The sale is over |
| 400 | `INVALID_USER_ID` | `code`, `message` | The id is not valid |
| 429 | `RATE_LIMITED` | `code`, `message` | Per-IP rate limit exceeded (when `RATE_LIMIT_ENABLED=true`, keyed by `request.ip` under `TRUST_PROXY`). Allowed responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`; `429` also sets `Retry-After` |
| 503 | `TEMPORARY_FAILURE` | `code`, `message` | The reservation could not be made, or was released |

```json
{
  "code": "RESERVED",
  "orderId": "cf353d1d-637c-460c-8f4d-4edc52b6227d",
  "userId": "alice@example.com",
  "message": "Your unit is reserved; the order is being confirmed"
}
```

```json
{ "code": "ALREADY_PURCHASED", "message": "This user already holds a unit from this sale" }
```

**202 is a promise to write the order, not the order.** The reservation is in Redis, and a worker writes the PostgreSQL row right after. Poll `GET /orders/user/:userId` to see it become `CONFIRMED`. A 202 can in rare cases be withdrawn, and the lookup then shows `NONE`: when PostgreSQL stays down for more than about 5 minutes, or when Redis loses data. [fault-tolerance.md](fault-tolerance.md) lists them.

**After a 503, look the order up before trying again.** In one rare case (a crash between the reservation and the enqueue) the unit is held for 30 to 60 s, and a retry gets 409 until the sweep releases it. The lookup tells you which case you are in.

Every request makes a new order id, so a retry after a lost 202 is a new attempt, and it gets 409 because the first one succeeded. The lookup then shows that order.

## `GET /api/v1/orders/user/:userId`

The id is normalized the same way as in the purchase.

```json
{
  "userId": "alice@example.com",
  "hasPurchased": true,
  "status": "CONFIRMED",
  "orderId": "cf353d1d-637c-460c-8f4d-4edc52b6227d"
}
```

| `status` | `hasPurchased` | `orderId` | Meaning |
| --- | --- | --- | --- |
| `RESERVED` | true | set | The unit is reserved and the order is not yet in PostgreSQL |
| `CONFIRMED` | true | set | The order is in PostgreSQL |
| `NONE` | false | `null` | No order, and no reservation |

```json
{ "userId": "nobody-here", "hasPurchased": false, "status": "NONE", "orderId": null }
```

The lookup answers from Redis first, in constant time (`readSlotWithLedgerState` checks `:users` and `EXISTS` on `:config` and `:stock` in one `MULTI`). When the user has no slot and the Redis ledger is intact, it answers `NONE` directly without touching PostgreSQL (preventing cache-penetration DB scans on unknown users); only when ledger keys are missing does it query PostgreSQL, returning `503 TEMPORARY_FAILURE` if PostgreSQL is also down. A purchase answers 202 in a few milliseconds and the worker is fast, so a lookup right after a purchase usually already says `CONFIRMED`, and `RESERVED` shows up only in a short window. An invalid id answers 400. When `RATE_LIMIT_ENABLED=true`, responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining` (keyed by route template + `request.ip`, governed by `TRUST_PROXY`), and exceeding the per-IP limit answers 429 `RATE_LIMITED` with `Retry-After`.

## `POST /api/v1/admin/flash-sales/reset`

A demo and test tool. It answers 404 unless `ENABLE_ADMIN_ENDPOINTS=true` (the code default is `false`, while `.env.example` and Compose turn it on). When `ADMIN_API_KEY` is non-empty, callers must pass a matching `x-admin-key` header (checked with constant-time comparison) or receive `401 UNAUTHORIZED`.

Every field is optional, and a missing body counts as `{}`.

| Field | Type and range | Meaning |
| --- | --- | --- |
| `totalStock` | integer, 0 to 1,000,000 | Units for sale. Also sets `remaining_stock` |
| `startsOffsetSeconds` | integer, ±1 year | Start, in seconds from now. Negative opens the window in the past |
| `durationSeconds` | integer, 1 second to 1 year | Length of the window |
| `startsAt`, `endsAt` | ISO-8601 timestamps | An absolute window. Cannot be mixed with the two relative fields |

Absent fields fall back to the configured sale (see `SALE_*` in [development.md](development.md#configuration)). Unknown fields, including `productName`, answer 400.

```sh
curl -X POST localhost:3000/api/v1/admin/flash-sales/reset -H 'content-type: application/json' \
  -d '{"totalStock":3,"startsOffsetSeconds":0,"durationSeconds":3600}'
```

The answer is the new sale status, in the same shape as `GET /flash-sales/current`.

| Status | `code` | Example message |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | `property productName should not exist` |
| 400 | `BAD_REQUEST` | `startsAt/endsAt cannot be combined with startsOffsetSeconds/durationSeconds` |
| 400 | `BAD_REQUEST` | `endsAt must be after startsAt` |
| 400 | `BAD_REQUEST` | `totalStock must not be greater than 1000000` |
| 503 | `TEMPORARY_FAILURE` | `Temporarily unable to process the request; please retry` (when `maintenance_lock` stays held for 2 s or in-flight jobs outlast 10 s) |

A reset acquires `flash_sale:{saleId}:maintenance_lock` (retrying up to 20 × 100 ms), pauses and drains the queue, deletes Redis ledger keys (`invalidateState`), drops the sale's orders and rewrites the sale row in one SQL statement, replaces Redis state, drops the 200 ms status cache, and resumes the queue in `finally`. [fault-tolerance.md](fault-tolerance.md#reset-and-why-it-can-recover) shows how it recovers from a failure in the middle. It is not linearizable with concurrent purchases, so reset before the traffic starts.
