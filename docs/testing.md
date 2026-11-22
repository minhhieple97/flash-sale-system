[← README](../README.md)

# Testing

The strategy is to put each guarantee under the cheapest test that can really prove it, and to add a more expensive level only where a cheaper one lies. A mock cannot prove that a Lua script is atomic, so Redis tests run against a real Redis. A unit test cannot prove that 100 buyers sell exactly the stock, so a race test runs against the real app. Work was done test first: a failing spec, then the code.

## Levels

| Level | Where | Runs against | Files | Tests |
| --- | --- | --- | --- | --- |
| API unit | `apps/api/test/unit/` | Isolated unit specs (pinned clock; plus in-process Fastify HTTP and boundary specs) | 54 | 473 |
| API integration | `apps/api/test/integration/*.spec.ts` | Real PostgreSQL 16, Redis 7 and BullMQ | 28 | — |
| API end to end | `apps/api/test/integration/*.e2e-spec.ts` | The whole app over HTTP, real stores | 3 | — |
| Web | `apps/web/src/**/__tests__/` | Vitest and React Testing Library, only `fetch` stubbed | 21 | 196 |
| Script tests | `scripts/*.test.mjs` | `node --test` against fixture sources and the stress math | 5 | 66 |
| Stress | `tests/stress/` | The running Docker stack | 5 scenarios | |

The unit (473), web (196), and script (66) counts above passed on the current branch; the 31 API integration and end-to-end suites run in CI (`.github/workflows/ci.yml`) and `pnpm verify` (with the Compose `api` container stopped) under `--detectOpenHandles` with no open handle allowed. Run the commands in [development.md](development.md#commands) for live counts.

## What each level proves

### Unit

Unit specs pin time through `ClockService` and mock storage collaborators (with targeted in-process `NestFastifyApplication` + `supertest` specs for HTTP setup, filters, guards, and controllers, plus source-scanning boundary specs). They cover branching that is costly to reach for real: the purchase outcome table, the user id normalizer (including spellings that must collapse to one buyer), the environment schema (`TRUST_PROXY`, `APP_ROLE`, `SALE_*`, `RATE_LIMIT_*`), `RateLimitGuard` proxy handling and `RateLimitService` O(1) eviction, bootstrap lease retries and per-role sweep thresholds, mid-restore adoption retries, the reset plan, the orphan strike decision, the retry classification (only `OrderPersistenceRejectedError` skips retries, and `isFinalFailure` alone decides a job failed for good), the Redis fault detector, the exception filter, and the Redis client options (the hot path and the producer fail fast, and the worker keeps its blocking defaults).

### Integration

These are the tests that earn their cost. Each one runs a real script, a real worker or a real constraint.

| Risk | What the specs prove | Spec |
| --- | --- | --- |
| Overselling | The gate sells exactly the stock to 100 parallel distinct users, and one user wins once out of 50 parallel calls | `sale-ledger.reserve.redis.spec.ts` |
| The sale window | The four edges, `startsAt - 1`, `startsAt`, `endsAt` and `endsAt + 1`, answer `SALE_UPCOMING`, `RESERVED`, `RESERVED` and `SALE_ENDED` | `sale-ledger.reserve.redis.spec.ts` |
| Check order | `SALE_ENDED` before `SOLD_OUT`, and `ALREADY_PURCHASED` before `SOLD_OUT` | `sale-ledger.reserve.redis.spec.ts` |
| Lost state is not zero | A missing config hash or stock key answers `SALE_NOT_CONFIGURED`, never `SOLD_OUT` | `sale-ledger.reserve.redis.spec.ts`, `sale-ledger.state.redis.spec.ts` |
| Repeatable scripts | Every registered script, resent, leaves the same state and returns its declared resend reply (3 repeat the same reply; 4 return no-op `0`). A spec fails if a script has no resend case | `flash-sale-scripts.idempotency.redis.spec.ts` |
| Fences | A released reservation never comes back as `CONFIRMED`. A job whose entry is gone writes nothing | `order-persistence-fence.redis.spec.ts`, `sale-ledger.reservations.redis.spec.ts` |
| Adoption | An order that committed after its entry was lost is adopted (and retries while `!isIntact`), and a conflicting entry is left alone | `sale-ledger.adopt.redis.spec.ts`, `order-persistence.adopt.redis.spec.ts` |
| Database guards | The unique key, the stock guard, the two `CHECK` bounds, and the order insert with its transaction | `schema-constraints.db.spec.ts`, `orders-repository.db.spec.ts` |
| The pipeline | A real worker turns a reservation into a `CONFIRMED` order and decrements stock once | `order-persistence.pipeline.redis.spec.ts`, `order-persistence.queue.redis.spec.ts` |
| Lost enqueue reply | A stored job whose reply was lost keeps the reservation, and a job stored after a release does nothing | `order-persistence.lost-reply.redis.spec.ts`, `order-persistence-fence.redis.spec.ts` |
| Compensation | A committed order is confirmed and not released, and a reservation with no order is released and its unit returned | `order-compensation.redis.spec.ts` |
| Orphans | A jobless reservation is released on the second sighting and not the first, and one whose job appears between sweeps is kept | `orphan-sweeper.redis.spec.ts` |
| Lost Redis state & lease | After `FLUSHALL`, a tick acquires the maintenance lease and restores the ledger in 1,000-row batches from PostgreSQL | `ledger-maintenance.redis.spec.ts`, `flash-sale-hydration.redis.spec.ts`, `sale-ledger.lease.redis.spec.ts` |
| Reset | Acquire lease, pause, drain, invalidate Redis, delete/reschedule SQL, rebuild, resume. A job in flight cannot commit into the new sale. A failure after SQL commit heals via `pendingPlan` or `restoreIfLost` | `flash-sale-reset*.spec.ts` |
| Redis connections | The client waits for ready, the producer reconnects within 300 ms, and a closed client does not throw | `redis.module.redis.spec.ts`, `order-persistence-producer.redis.spec.ts` |
| Shutdown order | The worker and queue close before Redis quits, an in-flight job still confirms, and a tick blocked mid-sweep finishes before the queue closes | `shutdown-order.redis.spec.ts` |

After each pipeline test, `expectLedgerConverged` runs `sweepOrphans(saleId, 'INTERVAL')` twice to settle any jobless reservations, then asserts that no jobless `RESERVED` entry remains (pending-job reservations remain valid) and that Redis `stock` plus Redis `HLEN(users)` equals `totalStock`.

### End to end

The three `*.e2e-spec.ts` suites boot the whole application over HTTP against real stores. `flash-sale-race.e2e-spec.ts` fires 100 buyers at 10 units and expects 10 × 202 and 90 × 410, 10 orders and `remaining_stock` 0, then fires 50 requests from one buyer in case and whitespace variants and expects 1 × 202 and 49 × 409. `flash-sale-flow.e2e-spec.ts` walks the whole life of a sale, and `app.e2e-spec.ts` checks the HTTP surface.

### Web

The web specs run the real HTTP client, hooks and components, and stub only `fetch`. Vitest's fake timers move the polling and the countdown, so no spec sleeps. They cover the server-corrected clock offset, the effective sale state at the opening second, the polling lifecycle (no overlap, abort on unmount), the Buy Now lock rules, every outcome banner, the confirmation poller's four phases, and the demo toolbar.

### Not covered

- **No browser-driven test** is part of the suites. The storefront is tested through Testing Library against a stubbed `fetch`, and was driven by hand in the Docker stack through nginx.
- **No automated mutation testing.** During review, selected specs were checked against deliberately broken code, for example a mutant of the enqueue-failure path that turned an integration test red. That was done by hand and is not repeatable from the repo.

## Static checks

`pnpm lint` runs Biome with `--error-on-warnings`, then `node scripts/arch-check.mjs`.

Biome is the only linter and formatter. On top of its `recommended` preset these rules are errors.

| Rule | Why |
| --- | --- |
| `noExplicitAny` | The repo has no `any` in `src/` or `test/` |
| `noConsole` | The API logs through Nest's logger. Only `tests/stress/` and `scripts/` may print |
| `noExcessiveCognitiveComplexity`, max 10 | Forces guard clauses and small functions |
| `noUselessElse` | Early returns instead of `else` chains |
| `useImportType`, web only | Type-only imports vanish from the bundle. The API keeps it off because Nest's dependency injection reads constructor types at runtime |

TypeScript 6 runs with `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals` and `noUnusedParameters` in both apps.

Biome cannot express the architecture rules, so `scripts/arch-check.mjs` walks every source file with the TypeScript compiler API. It has its own tests, which run fixture sources through each rule.

| Rule | Fails when |
| --- | --- |
| `max-file-lines`, `max-function-lines`, `max-params` | A source file (including `scripts/` and `tests/stress/`) passes 220 lines (a spec, 250), a source function passes 40 lines (`max-function-lines` skips tests), or a function takes more than 3 positional parameters (constructors are exempt from `max-params` only) |
| `invalid-exception` | An `// arch-check-allow` marker names a non-size rule or omits a reason |
| `no-forward-ref` | Any file calls `forwardRef` |
| `controller-injection` | A controller imports or injects TypeORM, ioredis, BullMQ, a repository, `DataSource` or `Redis` |
| `service-raw-storage` | A service or processor imports TypeORM or ioredis, calls a raw Redis or SQL method, or contains a SQL literal |
| `redis-client-owner`, `infrastructure-imports-modules` | Code outside `infrastructure/redis`, `sale-ledger` and the health cache uses `REDIS_CLIENT`, or code under `infrastructure/` imports from `modules/` |
| `module-barrel-import`, `web-string-keyed-record` | A web module imports another module's internals, or a web constants file types a map with `string` keys |

Only the three size rules take an exception, written as `// arch-check-allow <rule>: <reason>`. For `max-function-lines` and `max-params`, the comment goes on the line above the function. For `max-file-lines`, it goes anywhere in the file. The repository has no exceptions.

Specs guard the rest of the design rules: `sale-ledger.boundary.spec.ts` fails when a file outside `sale-ledger` imports its internals or `src/infrastructure/` imports `src/modules/`, `redis-connection.options.spec.ts` pins the fail-fast options, and the retry classification spec pins which errors skip retries.

## The gate

`pnpm verify` runs every check in order and prints one `PASS` or `FAIL` line per step, then `VERIFY OK` or `VERIFY FAILED`. A failing step prints the last 30 lines of its log.

1. The `postgres` container is healthy.
2. The `redis` container is healthy.
3. `pnpm lint`.
4. `pnpm test:scripts`.
5. `pnpm -r typecheck`.
6. The compose `api` container is stopped.
7. Every API Jest suite under `--detectOpenHandles`, without `--forceExit`, inside a 300 s timeout. Any open handle fails the step.
8. The web Vitest suite.
9. `pnpm -r build`.

Step 6 exists because the integration suites share the compose PostgreSQL, Redis and queue name. A running `api` container's worker takes the suites' jobs and fails them. Step 7 forbids `--forceExit`, so a leaked connection fails the gate and does not hide behind a forced exit. GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the same `quality-and-unit` checks plus `api-integration` against PostgreSQL 16 and Redis 7 on pushes to `main` and pull requests.

## Test conventions

- **Arrange, act, assert** in every test, with names that state the behavior: `returns ALREADY_PURCHASED when ...`.
- **No wall-clock sleeps.** Time comes from `ClockService` in the API and from fake timers in the web app. Integration specs wait on a condition with a deadline.
- **Tests check behavior and contracts**, not private methods.
- **Integration specs run one file at a time** (`maxWorkers: 1`), because they share one queue and run real workers.
- **A guard in the test setup** refuses any connection to Redis port 6379 unless `REDIS_PORT` is 6379. A client built without its options would fall back to that port, and on many machines that port belongs to another program, which a test must never write to.

## Stress tests

The stress suite runs against the real stack and checks the stores afterwards, so it proves the concurrency controls and not only the response codes. The scenarios, the checks, how to run them and the results are in [benchmarks.md](benchmarks.md). In short:

| Scenario | Proves |
| --- | --- |
| `oversell` | 5,000 buyers on 100 units sell exactly 100 units |
| `same-user-race` | 300 requests from one buyer, in four spellings, yield one 202 |
| `mixed` | Repeats and losers over 6,000 requests yield the exact 202, 409 and 410 counts |
| `pg-blip` | Every 202 still ends `CONFIRMED` after PostgreSQL is stopped for 45 s |
| `realistic-mix` (opt-in) | Mixed read+write burst through nginx in k6 (`250` buyers + `50` readers + `30` non-buyer lookups) checks 100/4900 split, 0 read/lookup failures, and latency thresholds (`node tests/stress/node-stress-runner.mjs realistic-mix` runs only the 5,000-buyer burst) |

Both the Node runner and k6 scripts support optional `ADMIN_API_KEY` (sent as `x-admin-key` on reset calls). After each scenario the Node runner polls until every 202 is `CONFIRMED`, then reads PostgreSQL and Redis and checks that the order ids equal the 202 ids, `remaining_stock` equals `total_stock` minus the orders, Redis stock equals the stock minus the reservations, and the Redis buyer hash holds one `CONFIRMED` entry per reservation. The checks can fail: a stray order row inserted mid-run turned the `mixed` scenario red with three `FAIL` lines.
