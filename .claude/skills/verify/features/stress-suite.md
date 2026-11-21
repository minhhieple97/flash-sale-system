# Stress suite

Status: implemented (Phase 5).

A reviewer fires thousands of purchase attempts at the running stack and checks that the sale never oversells and that one buyer gets at most one unit. The k6 scripts gate on exact status counts and p95 and p99 budgets. The Node runner fires the same scenarios, waits for the queue to persist every reservation, and checks PostgreSQL and Redis against the HTTP results.

## Layout

`tests/stress/` is linted by the root `pnpm lint` and size-checked by `scripts/verify-agent-limits.mjs`, like the apps.

- `scenarios.mjs`: scenario definitions, paths, `STATUS_METRICS`, `RESERVED_STATUS` and `EXPECTED_STATUSES`. Shared by k6 and Node.
- `store-keys.mjs`: the Redis key builders and the `CONFIRMED:` prefix. The one place the suite mirrors the API's wire format. Shared with k6 later, so it uses no Node built-ins.
- `k6-purchase.mjs`, `oversell-stress.k6.js`, `same-user-race.k6.js`: the k6 side (import only `scenarios.mjs`).
- `node-stress-runner.mjs`: entry point; runs `Object.values(SCENARIOS)`.
- `http-client.mjs` (node:http client), `load-driver.mjs` (reset, fire, drain), `store-snapshot.mjs` (`docker compose exec` into Postgres and Redis), `invariants.mjs` (the checks), `report.mjs` (latency and printing).

## Sub-features

- `k6-oversell` runs 5,000 distinct buyers over 250 VUs against 100 units. Thresholds: `reserved_202 == 100`, `sold_out_410 == 4900`, `conflict_409 == 0`, `unexpected_5xx == 0`, purchase `p(95) < 250ms` and `p(99) < 500ms`.
- `k6-same-user` runs 300 requests over 100 VUs from 4 case and whitespace variants of `stress-racer@example.com` against 50 units. Thresholds: `reserved_202 == 1`, `conflict_409 == 299`, `sold_out_410 == 0`, `unexpected_5xx == 0`.
- In `oversell` (`shouldWarmConnections: true`), each k6 VU opens its connection with an untimed `GET /health` (tag `endpoint:warmup`) before its first purchase. The time this took is the `connection_warmup` trend. The budgets judge only `endpoint:purchase`. The race fires cold on purpose, so its 300 requests land together.
- `node-runner` runs both scenarios. Before the oversell burst it opens one keep-alive socket per worker with `GET /health`. After each burst it polls the order lookup until every 202 buyer is `CONFIRMED`, then checks PostgreSQL order ids against the 202 order ids, `remaining_stock`, Redis stock, the Redis buyer hash, conservation, and the normalized owner of the race order.

## How to get to it (user POV)

- With the stack up (see [docker-stack.md](./docker-stack.md)), run `pnpm stress:k6:oversell`, `pnpm stress:k6:same-user`, and `BASE_URL=http://localhost:<api-port> pnpm stress:node`.

## Driving it with verify/bin

Preconditions:

- The stack is up and healthy, with the API on host port 3001 (`PORT=3001 docker compose up -d --build --wait`).
- Nothing else is resetting the sale or buying stock. Every scenario starts with an admin reset. Other sessions and worktrees share this Postgres, Redis and queue: check `docker compose exec -T redis redis-cli CLIENT LIST` for clients that are neither the api container nor `127.0.0.1`, and agree on a window first.
- The shell's `node` is the repo's Node (`nvm use` reads `.nvmrc`, 24). `pnpm stress:node` runs whatever `node` is first on `PATH`, and this machine's default shell has 18.17.1. On it, pnpm stops with `ERR_PNPM_BAD_RUNTIME_VERSION` because the root `devEngines.runtime` requires Node 24 or later.

- **k6 oversell.** `pnpm stress:k6:oversell` exits 0 and the THRESHOLDS block shows `✓ 'count==100'`, `✓ 'count==4900'`, `✓ 'p(95)<250'`, `✓ 'p(99)<500'` and `✓ 'count==0'` for `conflict_409` and `unexpected_5xx`. CUSTOM lists `connection_warmup`.
- **k6 same user.** `pnpm stress:k6:same-user` exits 0 with `✓ 'count==1'` and `✓ 'count==299'`.
- **Node runner.** `BASE_URL=http://localhost:3001 pnpm stress:node` prints `client node v24...` with `250 keep-alive sockets warmed in <n>ms` for oversell and `connections opened cold` for the race, then throughput, latency, the client's event-loop delay, the counts, 27 `PASS` lines, and `STRESS OK` with exit 0.
- **The checks can fail.** Run the runner while a background command inserts a stray order one second in:
  `(sleep 1; docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "INSERT INTO orders (id, flash_sale_id, product_id, user_id) SELECT gen_random_uuid(), id, product_id, '"'"'mutant-user'"'"' FROM flash_sales"') &`
  It ends `STRESS FAILED` with `FAIL PG order ids equal 202 order ids pg 101, 202s 100`. For k6, copy `tests/stress` to a scratch directory, change `reserved_202: 100` to `99` in its `scenarios.mjs`, and run k6 with that copy mounted at `/scripts`. It exits 99 with `✗ 'count==99' count=100`. In a copy whose `run()` skips `warmConnection()`, the opening-wave wait lands in the purchase latency again. k6 exited 99 with `✗ 'p(99)<500'` in 3 of 4 runs, with p99 between 1.3 and 5.9 s. In the fourth run, fewer than 1% of requests were stuck (p99 138 ms, max 1.08 s).
- **Proof.** Save the full output of each run under `.verify-evidence/<run-id>/stress/`, and report the THRESHOLDS blocks and the runner's PASS/FAIL lines.

## Gotchas

- The Node runner's latency includes its own event-loop queueing at 250 requests in flight, so it reports latency without gating on it. k6 owns the p95 and p99 budgets.
- Node 24 (libuv 1.52; the behavior starts in libuv 1.46) accepts one pending connection per event-loop iteration. Node 18's libuv 1.44 accepted every pending one at once. When 250 clients connect at once against a busy event loop, the API container's accept queue holds about 130 connections and drains by one every 10 to 20 ms. Those connections' first requests wait 0.3 to 3 s, arrive after the stock is gone, and return 410. Without the warm-up, this cluster holds 17 to 120 requests per run, so p99 jumps between about 130 ms and 3.2 s. The kernel counts no listen overflows and no retransmits. With the warm-up, oversell p99 was 49 to 98 ms over 9 runs on a warm API. `connection_warmup` still shows the wait, with a max of 1.5 to 2.3 s.
- Through nginx (`BASE_URL=http://web`), the API sees nginx's pooled HTTP/1.1 connections (`keepalive 64` in `apps/web/nginx.conf`). An oversell run made the API accept 6 to 15 connections and served about 2,050 purchase attempts per second (k6 `iterations` rate), with p95 133 to 143 ms. Before the pool, nginx opened one API connection per request: 5,252 accepts per run, twice the API CPU, about 1,160 attempts per second, and p95 296 to 340 ms, which failed `p(95)<250`. A client without keep-alive brings that cost back.
- The first one or two oversell runs after the API container starts are slower while the JIT warms up. On 2026-11-21, the second run after a start still failed `p(95)<250` at 297 ms. Run one oversell to warm up before you judge a budget or throughput.
- In zsh, write Redis keys as `"flash_sale:${SALE}:stock"`. A bare `$SALE:stock` parses as a `:s` modifier and fails.
- The k6 container runs as a non-root user. Pass `--user $(id -u):$(id -g)` when it must write output, such as `--out csv`, into a host directory.
