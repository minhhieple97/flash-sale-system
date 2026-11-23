# Benchmarks

The current code is faster on CPU per request and throughput, and shows no measurable change in p99 latency. Every claim below comes from interleaved runs on one machine on one day (2026-11-22), and the machine was never quiet. Read the caveats before you quote an absolute number.

## Verdicts

Three API images ran the same load in the 3-way comparison below. `before` is the baseline implementation prior to durability and hot-path tuning. `current` is the current implementation. `no-tuning` is `current` without the hot-path tuning, meaning without `enableAutoPipelining` on the hot-path Redis client and without the logger `exclude` list for the three hot routes. Each cell is the median with the range in brackets, over 6 gated rounds per image. `p` is an exact two-sided Mann-Whitney test. The separate `realistic-mix` section later on this page measures the current code end-to-end through nginx.

| Claim | Verdict | Number | Limiter |
| --- | --- | --- | --- |
| API CPU per request drops against `before` | **Faster** | 222 µs [208 to 443] against 322 µs [304 to 463], -31%. p=0.041, and `current` was lower in 6 of 6 paired rounds | One Node main thread, 0.86 to 0.89 core, 90 to 94% of the API container's CPU |
| The drop comes from the hot-path tuning | **Faster, and the tuning is the cause** | `current` 222 µs against `no-tuning` 350 µs [319 to 491], -37%, p=0.041, 6 of 6 paired rounds. `no-tuning` is not below `before`. Redis reads per `EVALSHA` fall from 0.9 to 0.0 to 0.1, and Redis CPU per run from 1,959 ms to 555 ms (p=0.002) | Same |
| Throughput rises | **Faster** | 4,486 req/s [2,159 to 4,786] against 3,119 [1,802 to 3,227] for `before` (+44%) and 2,838 [2,037 to 3,105] for `no-tuning` (+58%). p=0.041, 6 of 6 paired rounds | Same. The machine ran near saturation for `current` (3.69 of 4 cores busy), so the gain is probably understated |
| The durability work costs throughput | **No measurable difference** | `no-tuning` 2,838 against `before` 3,119 req/s, p=0.31. The ranges overlap | Same |
| The durability work costs p99 | **No measurable difference** | `no-tuning` 126 ms [113 to 201] against `before` 127 ms [102 to 253], p=0.82 | p99 is not set by CPU per request here |
| p99 improves overall | **No measurable difference** | `current` 121 ms [115 to 208] against `before` 127 ms [102 to 253], p=0.82. p50 does drop, from 63.6 to 39.7 ms (p=0.041) | |
| Correctness holds under load | **Holds** | Every run returned 5xx 0, `http_req_failed` 0%, exactly 100 × 202 and 19,900 × 410 (4,900 × 410 at 5,000 requests), 100 orders in PostgreSQL, PostgreSQL `remaining_stock` 0 and Redis stock 0. The API wrote no log lines | |

The durability work (the persistence retry, idempotent reserve, compare-and-set confirm, continuous ledger healing and the single ledger owner) has one measurable cost. Redis CPU per run is 6% higher, with `no-tuning` above `before` in 6 of 6 rounds. API CPU per request is 4% higher, which is not significant (5 of 6 rounds, p=0.22). `EVALSHA` calls per run rise from 20,226 to 20,326, which is one more Lua call per reservation. The likely cause is the compare-and-set confirm and the heavier idempotent scripts. Neither was isolated. The throughput and p99 verdicts have about ±10% resolution, because run-to-run spread on this machine is ±15 to 30%.

## Method

- **Images.** Each image is built from `git archive <commit>`, never a working tree, with `apps/api/Dockerfile`. All three run `NODE_ENV=production` and `LOG_LEVEL=info` with the same compose environment, against the same PostgreSQL and Redis containers. The web container was stopped. Node is v24.22.3 in the API image, and k6 is 1.8.3 in a container on the compose network.
- **A run.** The API container is recreated from one image and waits healthy. One discarded 20,000-request run then warms the JIT, because the first runs after a boot are slower. A gate waits until the idle machine shows under 1.5 busy cores over 5 s. One k6 run follows, then a poll until PostgreSQL holds 100 orders. Each round runs `before`, `current` and `no-tuning` in that order, with a 20,000-request run and a 5,000-request run each. There were 6 rounds.
- **Load.** The oversell scenario with the request count raised to 20,000 on 250 virtual users and 100 units. These runs used the earlier k6 driver, which has no connection barrier. Its reset sends an explicit open-now window, so all three images reset to the same state.
- **CPU per request.** The API container's CPU time over the run, divided by the request count. The counters come from the Docker API, read before and after the run from outside the containers. Redis and PostgreSQL CPU come the same way. `EVALSHA` counts, Lua time and Redis reads come from Redis `INFO`.
- **Statistics.** Medians, ranges and an exact Mann-Whitney test on 6 values per side, plus a paired comparison of the 6 per-round ratios.

## Results

### 20,000 requests at 250 virtual users

| Metric | before | current | no-tuning |
| --- | --- | --- | --- |
| Throughput (req/s) | 3,119 [1,802 to 3,227] | 4,486 [2,159 to 4,786] | 2,838 [2,037 to 3,105] |
| p50 (ms) | 63.6 [52.5 to 102] | 39.7 [33.7 to 72.7] | 64.2 [62.1 to 79.1] |
| p95 (ms) | 102 [81.3 to 186] | 84.3 [76.2 to 156] | 99.0 [91.3 to 139] |
| p99 (ms) | 127 [102 to 253] | 121 [115 to 208] | 126 [113 to 201] |
| API CPU per request (µs) | 322 [304 to 463] | 222 [208 to 443] | 350 [319 to 491] |
| Redis CPU per run (ms) | 1,802 [1,662 to 2,436] | 555 [516 to 798] | 1,959 [1,837 to 2,509] |
| Redis reads per `EVALSHA` | 0.9 | 0.0 to 0.1 | 0.9 |
| Last 202 to last order confirmed (ms) | 2,746 [2,088 to 3,801] | 1,505 [1,416 to 2,461] | 2,990 [2,093 to 3,470] |

The 202-to-confirmed time halves because the event loop is less busy, which the persistence worker shares. The p99 does not move. In this closed loop the tail is set by stalls, not by mean service time. A worker sharing the loop during the 100-order burst is the likely cause, but this was not measured.

### 5,000 requests at 250 virtual users

Same images, same rounds. The 5,000-request runs include connection warm-up, so they are not used as evidence for the CPU claim.

| Image | req/s | p50 (ms) | p95 (ms) | p99 (ms) | CPU per request (µs) |
| --- | --- | --- | --- | --- | --- |
| before | 2,414 [896 to 2,631] | 48.0 [31.5 to 97.1] | 72.8 [51.4 to 188] | 97.1 [58 to 229] | 401 |
| current | 3,238 [1,679 to 3,602] | 33.8 [27.9 to 57.9] | 68.5 [54.3 to 105] | 101 [67.8 to 131] | 307 |
| no-tuning | 2,208 [1,762 to 2,665] | 43.4 [39.3 to 68.3] | 67.3 [61.8 to 114] | 90.7 [72.1 to 142] | 464 |

The direction repeats the 20,000-request result. Throughput is 1.40 times `before` (6 of 6 rounds), CPU per request is 0.74 times (6 of 6), and p99 shows no difference (3 of 6).

### The repository's stress suite on `current`

Measured on 2026-11-23 after updating `SCENARIOS.mixed` so duplicate requests per user race concurrently inside the opening 250-request wave while stock is still live:

| Command / Stack | Result |
| --- | --- |
| `pnpm stress:node` (single-node, `http://localhost:3000`) | `STRESS OK`, 53 `PASS` lines across `oversell`, `same-user-race`, `mixed` and `pg-blip` |
| Node `oversell`, 5,000 requests (single-node) | 2,160.0 req/s (mid-run 2,399.7), p50/p95/p99 of 99.2, 195.1 and 339.4 ms, 100 × 202, 4,900 × 410 |
| Node `same-user-race`, 300 requests (single-node) | 2,010.2 req/s (mid-run 2,354.5), 45.7, 61.1 and 65.5 ms, 1 × 202, 299 × 409 |
| Node `mixed`, 6,000 requests (single-node) | 2,167.3 req/s (mid-run 2,091.1), 103.4, 178.8 and 207.8 ms, 100 × 202, 200 × 409, 5,700 × 410 |
| Node `pg-blip` (PostgreSQL stopped 45 s) | 3 × 202 all confirmed within 90 s, 97 × 410, conservation `PASS` |
| `BASE_URL=http://localhost:8080 pnpm stress:node oversell mixed same-user-race` (`--scale api=2` + `worker`) | `STRESS OK`, all response, PostgreSQL, Redis and conservation checks `PASS`; `oversell` 950.1 req/s (p50/p95/p99 195.4/430.4/2,530.2 ms); `mixed` 991.1 req/s (189.7/571.6/1,204.3 ms); `same-user-race` 1,275.2 req/s (68.7/127.1/133.0 ms) |
| `pnpm stress:k6:oversell` (2026-11-22 quiet-gated baseline) | Barrier 250 of 250 VUs, mid-run 3,533 req/s, 253 requests in flight on average, p95 and p99 of 110 and 132 ms, 202 p99 88.6 ms, 5xx 0, 100 × 202, 4,900 × 410, every threshold passed |
| `pnpm stress:k6:same-user` (2026-11-22 quiet-gated baseline) | Mid-run 2,134 req/s, p95 and p99 of 85 and 93 ms, 1 × 202, 299 × 409, 5xx 0 |

The k6 oversell script holds every virtual user at a barrier, so 250 purchases are in flight together, and it reports throughput without the warm-up. Its latencies come at about twice the concurrency of the driver used for the tables above, so compare them only with other runs of the same script. Each oversell virtual user opens its connection with an untimed `GET /health`, and the Node runner opens its keep-alive sockets the same way. The budgets then measure purchases and not connection setup. The Node runner checks PostgreSQL order ids, `remaining_stock`, Redis stock and conservation after every scenario, and all passed.

### Mixed read + write through nginx (`realistic-mix.k6.js`)

Measured on 2026-11-23 through `http://web:80` (nginx with `keepalive 256` and `keepalive_requests 10000`) on the 4-vCPU (2 physical cores SMT) WSL2 host (AMD Ryzen 5 5500U, Docker Desktop). `realistic-mix.k6.js` runs three overlapping scenarios (330 VUs total), all warming keep-alive sockets via `GET /health` behind the 5 s `t=0..5s` barrier before starting the burst together at `t=5s`:

- `buyers`: 250 VUs, 16,000 `POST /api/v1/checkout/purchase` iterations on 100 units (sized so buyer write saturation spans the entire 8 s read/lookup window; the earlier 2026-11-22 5,000-request setup finished buyers in ~3.3 s and left 59% of the 8 s window idle).
- `storefront_readers`: 50 constant VUs (`13s` total = 5 s warmup + 8 s active window), alternating `GET /api/v1/products/featured` (60 s singleflight cache) and `GET /api/v1/flash-sales/current` (200 ms singleflight cache).
- `order_lookups`: 30 constant VUs (`13s` total = 5 s warmup + 8 s active window), alternating 50% real buyer IDs (`stress-buyer-0..99`, expecting `200` and `NONE`/`RESERVED`/`CONFIRMED`) and 50% `non-buyer-...` (expecting `200` and `NONE`).

Single-node warmed run (`APP_ROLE=all`, host 1-minute load average 4.07) and scaled runs (`docker-compose.scaled.yml` with `--scale api=2` + dedicated `worker`, 2 runs at load average 6.42 and 3.32):

| Scenario / Metric | Single-node (`APP_ROLE=all`) | Scaled (`--scale api=2` + `worker`, run 1 / run 2) | Threshold (single-node) | Outcome (single-node) |
| --- | --- | --- | --- | --- |
| Buyers barrier VUs | 250/250 | 250/250 / 250/250 | `>= 238` | PASS |
| Buyers mid-run window (middle 80%) | 9.01 s | 12.18 s / 15.56 s | Overlaps full 8 s window | PASS |
| Buyers mid-run throughput | 1,420.1 req/s | 1,050.6 / 822.3 req/s | — | — |
| Buyers outcomes (`202` / `409` / `410` / `5xx`) | 100 / 0 / 15,900 / 0 | 100 / 0 / 15,900 / 0 | `100` / `0` / `15900` / `0` | PASS |
| Purchase latency p50 | 166.1 ms | 141.3 / 158.7 ms | — | — |
| Purchase latency p95 | 278.0 ms | 416.9 / 670.3 ms | `< 400 ms` | PASS |
| Purchase latency p99 | 335.8 ms | 551.6 / 1,135.2 ms | `< 650 ms` | PASS |
| Storefront reads (8 s window) | 4,367 reqs (545.9/s) | 2,114 (264.3/s) / 1,091 (136.4/s) | `count > 0`, `read_failures == 0` | PASS |
| Read latency p50 / p95 / p99 | 76.6 / 151.9 / 234.0 ms | 133.0 / 349.0 / 452.2 ms (run 2: 198.8 / 891.2 / 1,811.2 ms) | `p(99) < 450 ms` | PASS |
| Order lookups (8 s window) | 1,708 reqs (213.5/s) | 1,024 (128.0/s) / 589 (73.6/s) | `count > 0`, 50% real + 50% non-buyer | PASS |
| Lookup latency p50 / p95 / p99 | 129.1 / 211.5 / 286.6 ms | 168.9 / 394.9 / 498.2 ms (run 2: 222.8 / 933.5 / 1,943.9 ms) | `p(99) < 600 ms` | PASS |
| `http_req_failed` | 0.00% | 0.00% / 0.00% | — | PASS |

Post-run PostgreSQL and Redis checks confirmed `total_stock = 100`, `remaining_stock = 0`, `100` distinct orders in PostgreSQL, Redis stock `0`, and `100` entries in `:users`. Under continuous 330-VU zero-think-time saturation (`250 buyers + 50 readers + 30 lookups`) across the full 8 s window on a single 4-vCPU host, two earlier pre-warm/contended 16,000-request single-node runs also recorded `purchase p95` of `310.8–323.9 ms`, `read p99` of `257.3–383.3 ms`, and `lookup p99` of `319.5–544.3 ms` with `0` errors (`5xx: 0`, `read_failures: 0`), motivating the updated full-overlap budgets above (`400 / 650 / 450 / 600 ms`). On `--scale api=2` + `worker` on the same 2-physical-core laptop, splitting traffic across 2 Node API containers + 1 worker + 4 nginx workers + k6 + Redis + PostgreSQL overcommits the 2 physical cores (which already carry ~1.2–1.4 idle-host busy cores), reducing aggregate throughput and widening tail latency relative to single-node while preserving `0%` request failures and strict store invariants; horizontal scaling benefits require dedicated CPU cores per API replica.

**Root-cause finding (nginx keepalive fix, 2026-11-22):** On the initial `keepalive 64` config (with default `keepalive_requests 1000`) and cold `startTime: '4s'` readers/lookups, baseline runs hit `1.6–3.4 s` tail spikes (`purchase p99` `693.9–1,026.3 ms`) because 80 active reader/lookup VUs exceeded the 64-connection idle pool right before 250 buyers woke at `t=5s`. Raising `keepalive 256` (`keepalive_requests 10000`) in `apps/web/nginx.conf` and warming all 330 VUs during `0–5 s` eliminated those accept-queue spikes.

## What limits the number

- **One Node main thread.** `current` reaches 4,486 req/s at 222 µs per request, which is 1.00 core. `before` reaches 3,119 req/s at 322 µs, also 1.00 core. Both match one saturated main thread, so the throughput cannot double without more CPU per thread.
- **Redis and PostgreSQL have room.** Redis used 0.10 core on `current` and at most 0.24 core on the others. PostgreSQL used 0.05 to 0.09 core. Redis per request fell from 90 µs to 28 µs.
- **The machine is close to full.** Means over the load window were 3.45, 3.69 and 3.48 busy cores of 4 for `before`, `current` and `no-tuning`, with k6 at 0.66, 1.11 and 0.70 cores. k6 is not saturated, but it competes for the same cores. `current` ran under more contention than `before`, which biases against it.
- **The tuning touches about 40% of API CPU.** A profile of the earlier code put about 24% in the ioredis write path and 16.5% in the request-logging middleware. Removing 40% allows at most 1.67 times the speed. The measured 1.55 times is inside that bound.

## Caveats

- **Load.** The machine was never quiet. With the stack idle, `/proc/stat` showed 1.2 to 1.4 busy cores that no process accounts for. The 1-minute load average stayed between 1.3 and 5.5 and never fell below 1.0. During runs the machine reached 3.45 to 3.69 of 4 busy cores.
- **SMT.** The 4 vCPUs are 2 physical cores with 2 threads each (AMD Ryzen 5 5500U, WSL2 under Docker Desktop), so the API thread shares a core with that outside load and with k6, Redis and PostgreSQL.
- **CPU per request inflates under contention.** `current` read 443 µs in the first round and 208 to 263 µs in quieter rounds. Interleaving and per-round pairing make the comparison fair. They do not make the absolute numbers comparable across days.
- **Earlier numbers are not a control.** An earlier session measured 3,033 req/s and p99 52 ms at 5,000 requests for the `before` code on a quieter machine. On the day of these runs the same code ran about 20% slower with p99 near twice that. The earlier figures show only that `before` clears the stress budgets on a quiet machine.
- **Small samples.** With n=6 per side, p=0.041 is modest, and one contended round (the first) holds it there. Dropping that round, after the fact, gives p=0.0079 for every `current` comparison on CPU per request. The paired 6 of 6 result (sign test p=0.031) agrees.
- **The first series was discarded.** An earlier series, gated only on load average, ran with the machine 91 to 97% busy in two rounds. It points the same way (CPU per request 442, 303 and 487 µs for `before`, `current` and `no-tuning`, n=4), and one of its runs failed the p95 budget at 95% machine load with exact counts.
- **The nginx path was not measured in the 3-image comparison** (`web` was stopped for the `before` / `current` / `no-tuning` tables above). End-to-end traffic through nginx is measured separately in the `realistic-mix.k6.js` section above.

## Reproduce

Start the stack with `ENABLE_ADMIN_ENDPOINTS=true` and `RATE_LIMIT_ENABLED=false` (the Compose defaults; rate limiting would return 429s from a single load host), warm the JIT with one discarded run, then run the repository's own scripts.

```sh
docker compose up -d --build --wait
pnpm stress:k6:oversell >/dev/null                 # optional JIT warmup after container start
pnpm stress:k6:oversell                            # 5,000 requests, 250 VUs, thresholds on counts and latency
pnpm stress:k6:same-user
pnpm stress:k6:realistic                           # 330 VUs through nginx (250 buyers + 50 readers + 30 order lookups)
BASE_URL=http://localhost:3000 pnpm stress:node    # four scenarios, then PostgreSQL and Redis checks
```

Under `docker-compose.scaled.yml`, `api` does not publish host port `3000`, so point `stress:node` at nginx (`BASE_URL=http://localhost:8080`). If `ADMIN_API_KEY` is configured on the stack, pass `ADMIN_API_KEY=<secret>` to `pnpm stress:node` or to `docker compose run --rm --no-deps -e ADMIN_API_KEY=<secret> ... k6 run ...` so setup resets authenticate with `x-admin-key` (for `realistic-mix.k6.js`, also pass `-e BASE_URL=http://web:80` so k6 still goes through nginx instead of the service default `http://api:3000`).

`pnpm stress:node` includes `pg-blip`, which stops the compose PostgreSQL container for 45 s. The scenario table is `tests/stress/scenarios.mjs`, and both the k6 scripts and the Node runner read it.

These scripts reproduce the 5,000-request suite, not the 20,000-request tables. To get 20,000 requests, set `requests` to 20000 and `sold_out_410` to 19900 for `oversell` in `tests/stress/scenarios.mjs`. The current script adds the connection barrier, so its latencies are not comparable with the tables above. The interleaving, the quiet gate and the CPU sampler came from a local harness that is not part of this repository. To compare two commits, check each out in its own worktree, start each as a separate compose project (`docker compose -p <name>` with distinct `PORT`, `WEB_PORT`, `POSTGRES_PORT` and `REDIS_PORT`), and alternate runs between them on an idle machine.
