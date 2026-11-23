[← README](../README.md)

# Benchmarks & Stress Results

All numbers below come from controlled Docker Compose runs on one 4-vCPU (2 physical cores SMT, AMD Ryzen 5 5500U, WSL2) host. Because the machine shares cores across the API, Redis, PostgreSQL, nginx, and load generators (with ~1.2–1.4 idle host cores busy), read the caveats before quoting absolute numbers; paired ratios and correctness counts are the primary signal.

## 1. Hot-Path Tuning Study (3-Image Paired Comparison)

To isolate the impact of durability work and hot-path tuning (`enableAutoPipelining` on the hot-path Redis client + excluding the 3 hot routes from Pino request logging), three API images built from clean `git archive` snapshots ran 6 interleaved rounds against the same PostgreSQL 16 and Redis 7 containers (`NODE_ENV=production`, `LOG_LEVEL=info`, `web` stopped, 1 discarded 20k-request JIT warmup per container). Cells show median and `[min..max]` across 6 rounds; `p` is an exact two-sided Mann-Whitney test.

### 20,000 Requests at 250 Virtual Users (100 Stock)

| Metric | `before` (baseline) | `current` (tuned) | `no-tuning` (durability only) |
| --- | --- | --- | --- |
| **Throughput (req/s)** | 3,119 `[1,802..3,227]` | **4,486** `[2,159..4,786]` | 2,838 `[2,037..3,105]` |
| **p50 latency (ms)** | 63.6 `[52.5..102]` | **39.7** `[33.7..72.7]` | 64.2 `[62.1..79.1]` |
| **p95 latency (ms)** | 102 `[81.3..186]` | **84.3** `[76.2..156]` | 99.0 `[91.3..139]` |
| **p99 latency (ms)** | 127 `[102..253]` | 121 `[115..208]` | 126 `[113..201]` |
| **API CPU / request (µs)** | 322 `[304..463]` | **222** `[208..443]` | 350 `[319..491]` |
| **Redis CPU / run (ms)** | 1,802 `[1,662..2,436]` | **555** `[516..798]` | 1,959 `[1,837..2,509]` |
| **Redis reads per `EVALSHA`** | 0.9 | **0.0–0.1** | 0.9 |
| **Last `202` → last PG confirm (ms)** | 2,746 `[2,088..3,801]` | **1,505** `[1,416..2,461]` | 2,990 `[2,093..3,470]` |

**Key findings:**
- **-31% API CPU/req & +44% throughput vs `before`** (`p = 0.041`, 6/6 paired rounds); **-37% CPU/req & +58% throughput vs `no-tuning`**, proving auto-pipelining and hot-route log exclusion drive the gain while durability mechanisms add no measurable throughput or p99 regression (`p = 0.31` / `p = 0.82`).
- **Redis CPU dropped 3.5×** (`1,959 → 555 ms`, `p = 0.002`) as auto-pipelining collapsed socket reads per `EVALSHA` from `0.9` to `~0.0`.
- **Single-node limiter:** The Node main thread saturates 1.00 core (`4,486 req/s × 222 µs = 0.996 s`), while Redis uses only `0.10 core` (`28 µs`/req) and PostgreSQL `0.05–0.09 core`.
- **100% invariant accuracy:** Every single run returned `0` 5xx, `0%` `http_req_failed`, `100 × 202`, `19,900 × 410`, `100` PostgreSQL orders, and `0` remaining stock in both stores.

## 2. Repository Stress Suite (`pnpm stress:node` & k6)

All stress scenarios share a single scenario matrix (`tests/stress/scenarios.mjs`), warm keep-alive sockets via `GET /health` behind a barrier so latency budgets measure purchases rather than TCP handshakes, and assert zero oversell, exact per-user uniqueness, and Redis/PostgreSQL conservation.

| Scenario / Command | Workload | Measured Result |
| --- | --- | --- |
| `pnpm stress:node` (`oversell`) | 5,000 unique buyers, 100 stock, 250 concurrent (`localhost:3000`) | `2,118.5 req/s` (mid-run `2,345.4`), p50/p95/p99 `102.8 / 190.0 / 308.5 ms`, `100 × 202`, `4,900 × 410`, PG & Redis conservation `PASS` |
| `pnpm stress:node` (`same-user-race`) | 300 concurrent attempts by 1 buyer | `1,296.0 req/s` (mid-run `1,449.2`), p50/p95/p99 `74.6 / 107.8 / 115.9 ms`, `1 × 202`, `299 × 409`, `PASS` |
| `pnpm stress:node` (`mixed`) | 6,000 requests with 3× duplicate races in opening 250-req wave | `2,527.9 req/s` (mid-run `2,617.5`), p50/p95/p99 `96.9 / 149.0 / 156.4 ms`, `100 × 202`, `200 × 409`, `5,700 × 410`, `PASS` |
| `pnpm stress:node` (`pg-blip`) | 100 requests across a **45 s PostgreSQL container stop** | `3 × 202`, `97 × 410`, all `3` orders confirmed in PG within `90 s`, conservation `PASS` |
| `pnpm stress:k6:oversell` | 5,000 requests, 250 VUs with barrier | `250/250` barrier, mid-run `3,533 req/s`, p95/p99 `110 / 132 ms`, `202` p99 `88.6 ms`, `0` 5xx, all thresholds `PASS` |
| `pnpm stress:k6:same-user` | 300 requests, 1 buyer | Mid-run `2,134 req/s`, p95/p99 `85 / 93 ms`, `1 × 202`, `299 × 409`, `0` 5xx, `PASS` |

## 3. End-to-End Realistic Mix Through nginx (`pnpm stress:k6:realistic`)

Runs **330 overlapping VUs** through `http://web:80` (nginx `keepalive 256`, `keepalive_requests 10000`) after a 5 s keep-alive warmup barrier:
- **`buyers`:** 250 VUs, 16,000 `POST /api/v1/checkout/purchase` iterations on 100 units (spanning the entire 8 s read/lookup window).
- **`storefront_readers`:** 50 constant VUs alternating `GET /api/v1/products/featured` and `GET /api/v1/flash-sales/current` for 8 s.
- **`order_lookups`:** 30 constant VUs alternating 50% real buyer IDs (`stress-buyer-0..99`) and 50% unknown users (`non-buyer-*`) for 8 s.

| Metric | Measured (Through nginx) | Threshold | Status |
| --- | --- | --- | --- |
| Buyers barrier VUs | `250 / 250` | `>= 238` | `PASS` |
| Buyers mid-run window & throughput | `8.12 s` (`1,576.0 req/s`) | Overlaps full 8 s window | `PASS` |
| Buyers outcomes (`202 / 409 / 410 / 5xx`) | `100 / 0 / 15,900 / 0` | `100 / 0 / 15,900 / 0` | `PASS` |
| Purchase latency p50 / p95 / p99 | `147.6 / 291.5 / 401.2 ms` | p95 `< 400`, p99 `< 650 ms` | `PASS` |
| Storefront reads (8 s) | `4,768` reqs (`596.0/s`), `0` failures | `read_failures == 0` | `PASS` |
| Read latency p50 / p95 / p99 | `73.8 / 157.8 / 230.4 ms` | p99 `< 450 ms` | `PASS` |
| Order lookups (8 s) | `1,760` reqs (`220.0/s`), 50/50 split | `count > 0` | `PASS` |
| Lookup latency p50 / p95 / p99 | `116.4 / 219.0 / 329.0 ms` | p99 `< 600 ms` | `PASS` |
| `http_req_failed` | `0.00%` | `0%` | `PASS` |

**Engineering Finding (nginx `keepalive 256`):** Initial runs with `keepalive 64` and un-warmed reader/lookup VUs hit `1.6–3.4 s` tail spikes (`purchase p99` `694–1,026 ms`) because 80 active reader/lookup VUs saturated the 64-connection pool just as 250 buyers woke. Raising `keepalive 256` (`keepalive_requests 10000`) in `apps/web/nginx.conf` and warming all 330 VUs during `0–5 s` eliminated accept-queue spikes.

## 4. Caveats

- **Shared host contention:** The 4-vCPU WSL2 host has only 2 physical cores (SMT) and carried ~1.2–1.4 idle busy cores during runs; absolute numbers vary ±15–30% across days, while paired ratios and zero-error invariants remain deterministic.
- **No nginx in 3-image study:** Section 1 isolates the API directly (`web` stopped); end-to-end nginx proxy overhead is measured separately in Section 3.
- **Rate limiting disabled for load generation:** Single-host load tests run with `RATE_LIMIT_ENABLED=false` (Compose default) so one IP isn't throttled with `429`.

## 5. Reproduce

```sh
docker compose up -d --build --wait
pnpm stress:k6:oversell >/dev/null                 # optional JIT warmup
pnpm stress:k6:oversell                            # 5,000 requests, 250 VUs
pnpm stress:k6:same-user                           # 300 duplicate requests
pnpm stress:k6:realistic                           # 330 VUs mixed read+write through nginx
BASE_URL=http://localhost:3000 pnpm stress:node    # oversell, same-user-race, mixed, 45 s pg-blip
```

If `ADMIN_API_KEY` is configured on the stack, pass `ADMIN_API_KEY=<secret>` to `pnpm stress:node` or to `docker compose run --rm --no-deps -e ADMIN_API_KEY=<secret> ... k6 run ...` (for `realistic-mix.k6.js`, also pass `-e BASE_URL=http://web:80`).
