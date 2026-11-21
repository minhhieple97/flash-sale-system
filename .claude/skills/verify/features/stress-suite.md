# Stress suite

Status: implemented (Phase 5).

A reviewer fires thousands of purchase attempts at the running stack and checks that the sale never oversells and that one buyer gets at most one unit. The k6 scripts gate on exact status counts and a p95 budget. The Node runner fires the same scenarios, waits for the queue to persist every reservation, and checks PostgreSQL and Redis against the HTTP results.

## Layout

`tests/stress/` is linted by the root `pnpm lint` and size-checked by `scripts/verify-agent-limits.mjs`, like the apps.

- `scenarios.mjs`: scenario definitions, paths, `STATUS_METRICS`, `RESERVED_STATUS` and `EXPECTED_STATUSES`. Shared by k6 and Node.
- `store-keys.mjs`: the Redis key builders and the `CONFIRMED:` prefix. The one place the suite mirrors the API's wire format. Shared with k6 later, so it uses no Node built-ins.
- `k6-purchase.mjs`, `oversell-stress.k6.js`, `same-user-race.k6.js`: the k6 side (import only `scenarios.mjs`).
- `node-stress-runner.mjs`: entry point; runs `Object.values(SCENARIOS)`.
- `http-client.mjs` (node:http client), `load-driver.mjs` (reset, fire, drain), `store-snapshot.mjs` (`docker compose exec` into Postgres and Redis), `invariants.mjs` (the checks), `report.mjs` (latency and printing).

## Sub-features

- `k6-oversell` runs 5,000 distinct buyers over 250 VUs against 100 units. Thresholds: `reserved_202 == 100`, `sold_out_410 == 4900`, `conflict_409 == 0`, `unexpected_5xx == 0`, purchase `p(95) < 250ms`.
- `k6-same-user` runs 300 requests over 100 VUs from 4 case and whitespace variants of `stress-racer@example.com` against 50 units. Thresholds: `reserved_202 == 1`, `conflict_409 == 299`, `sold_out_410 == 0`, `unexpected_5xx == 0`.
- `node-runner` runs both scenarios, polls the order lookup until every 202 buyer is `CONFIRMED`, then checks PostgreSQL order ids against the 202 order ids, `remaining_stock`, Redis stock, the Redis buyer hash, conservation, and the normalized owner of the race order.

## How to get to it (user POV)

- With the stack up (see [docker-stack.md](./docker-stack.md)), run `pnpm stress:k6:oversell`, `pnpm stress:k6:same-user`, and `BASE_URL=http://localhost:<api-port> pnpm stress:node`.

## Driving it with verify/bin

Preconditions:

- The stack is up and healthy, with the API on host port 3001 (`PORT=3001 docker compose up -d --build --wait`).
- Nothing else is resetting the sale or buying stock. Every scenario starts with an admin reset.

- **k6 oversell.** `pnpm stress:k6:oversell` exits 0 and the THRESHOLDS block shows `✓ 'count==100'`, `✓ 'count==4900'`, `✓ 'p(95)<250'` and `✓ 'count==0'` for `conflict_409` and `unexpected_5xx`.
- **k6 same user.** `pnpm stress:k6:same-user` exits 0 with `✓ 'count==1'` and `✓ 'count==299'`.
- **Node runner.** `BASE_URL=http://localhost:3001 pnpm stress:node` prints throughput, latency, the client's event-loop delay, the counts, 27 `PASS` lines, and `STRESS OK` with exit 0.
- **The checks can fail.** Run the runner while a background command inserts a stray order one second in:
  `(sleep 1; docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "INSERT INTO orders (id, flash_sale_id, product_id, user_id) SELECT gen_random_uuid(), id, product_id, '"'"'mutant-user'"'"' FROM flash_sales"') &`
  It ends `STRESS FAILED` with `FAIL PG order ids equal 202 order ids pg 101, 202s 100`. For k6, copy `tests/stress` to a scratch directory, change `reserved_202: 100` to `99` in its `scenarios.mjs`, and run k6 with that copy mounted at `/scripts`. It exits 99 with `✗ 'count==99' count=100`.
- **Proof.** Save the full output of each run under `.verify-evidence/<run-id>/stress/`, and report the THRESHOLDS blocks and the runner's PASS/FAIL lines.

## Gotchas

- The Node runner's latency includes its own event-loop queueing at 250 requests in flight, so it reports latency without gating on it. k6 owns the p95 budget.
- k6's p99 swings between about 130 ms and 1.4 s from run to run. The slow requests are opening-wave 410s. The cause is not isolated, so compare p95 across runs, not p99.
- The first oversell run after the API container starts is slower while the JIT warms up. Judge throughput on the second run.
- In zsh, write Redis keys as `"flash_sale:${SALE}:stock"`. A bare `$SALE:stock` parses as a `:s` modifier and fails.
- The k6 container runs as a non-root user. Pass `--user $(id -u):$(id -g)` when it must write output, such as `--out csv`, into a host directory.
