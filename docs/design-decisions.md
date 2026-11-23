[← README](../README.md)

# Design decisions

Each decision below says what was chosen, why, what was rejected, and what it costs. The costs matter as much as the choices: [fault-tolerance.md](fault-tolerance.md) shows how each one is contained, and [scaling.md](scaling.md) shows where each one stops.

| # | Decision | Main alternative rejected |
| --- | --- | --- |
| 1 | Redis decides, PostgreSQL records | Decide in PostgreSQL on every attempt |
| 2 | One Lua script makes the decision | `WATCH` and retries, or a lock |
| 3 | The entry holds the order id, and every later write is fenced by it | A status flag |
| 4 | BullMQ on the same Redis, order id as job id | A second broker, or an in-process queue |
| 5 | Compensation asks PostgreSQL first | Release on any failure |
| 6 | Retry for at least 5 minutes at a fixed 2 s step | A few attempts with exponential backoff |
| 7 | Detect orphans with a periodic sweep | An atomic enqueue or a transactional outbox |
| 8 | Refusals are values, not exceptions | Throw and map in a filter |
| 9 | A fail-fast, auto-pipelined Redis client | Buffer commands while Redis is away |
| 10 | The API's clock decides the sale window | `redis.call('TIME')` in the script |
| 11 | One module owns every Redis key and format | Each module talks to Redis |
| 12 | `APP_ROLE=all` by default, with `api`/`worker` split built in | Require separate services even for local dev |
| 13 | Polling, with a server-corrected clock | Server-sent events or WebSocket |
| 14 | Raw SQL for the hot writes, DDL in code | An ORM and a migration tool |
| 15 | Optional rate limiting and admin key; no buyer auth | Mandatory login and always-on throttling |
| 16 | nginx keeps a connection pool to the API | One upstream connection per request |

## 1. Redis decides, PostgreSQL records

**Why.** A flash sale is mostly refusals. With 100 units and 5,000 buyers, 4,900 requests need no database write at all, and the 100 that do are better written off the request path. A purchase answers after one Lua call and one enqueue, so its latency does not depend on PostgreSQL.

**Rejected.** Decide in PostgreSQL with `UPDATE ... WHERE remaining_stock > 0`. It is correct and simple, but every attempt, including every refusal, takes the lock on the one sale row. The load that arrives at the worst moment would queue on a single row.

**Cost.** For a short time an order is `RESERVED` in Redis but not yet in PostgreSQL. Closing that window needs retries, compensation, a sweep and a restore, which are the largest part of the code. And Redis can lose up to about a second of writes, so PostgreSQL carries its own guards (`UNIQUE (flash_sale_id, user_id)`, `remaining_stock > 0`, two `CHECK` constraints).

## 2. One Lua script makes the decision

**Why.** Redis runs a script without interleaving. The checks (resend, window, duplicate, stock) and the writes (`DECR`, `HSET`) form one step, so two buyers cannot take the last unit and two requests from one buyer cannot both pass. It is one round trip and needs no lock.

**Rejected.** `WATCH` with `MULTI` retries under contention, which is the worst case in a flash sale: hundreds of clients retry the same key. A per-user lock plus a separate `DECR` takes two round trips and can fail between them, leaving a unit taken with no owner.

**Cost.** Every purchase goes through one Redis primary, which caps the design at one Redis core. The script is constant time, and Redis used 0.10 core at 4,486 req/s in the measurements, so the cap is far away ([benchmarks.md](benchmarks.md)). PostgreSQL's unique key and stock guard would still hold if Redis were wrong.

## 3. The entry holds the order id, and every later write is fenced by it

**Why.** The entry is `RESERVED:<orderId>`, not a flag. The worker confirms, compensation releases, and the sweep acts only while the entry still equals the order id they hold. A released reservation cannot come back as `CONFIRMED`, a late rollback cannot release a newer reservation, and two repairs racing each other cannot both act.

**Rejected.** A status flag per buyer. A job that runs late could not tell its own reservation from a newer one by the same buyer, and would resurrect or delete the wrong one.

**Cost.** Confirm and rollback are Lua compare-and-set scripts, not plain `HSET` and `HDEL`. That is two more scripts to write and test, and a spec resends every one of them.

## 4. BullMQ on the same Redis, with the order id as the job id

**Why.** The enqueue is one more command on a connection that is already open. Persistence comes from AOF. Retries, backoff, stalled-job recovery and dedupe are built in. The order id is unique per reservation, so a repeated enqueue of one reservation collapses to one job, and the same buyer can buy again after a reset without hitting an old job. `saleId:userId` would be a natural key, but BullMQ refuses `:` in a custom id.

**Rejected.** A second broker such as RabbitMQ or SQS would add a service and a new dual-write problem between Redis and the broker. An in-process queue is lost on a crash.

**Cost.** The ledger and the queue share one failure domain, and the enqueue is a second command after the script, not part of it. That gap is decision 7.

## 5. Compensation asks PostgreSQL first

**Why.** When a job fails for good, or even when a normal persist sees `!isReservationLive` after a Redis flush, the order may already have committed in PostgreSQL: the commit landed and only the Redis confirm was lost. A blind release (or blindly treating the job as stale) would return or lose a unit that is already sold. So `persistReservedOrder` checks PostgreSQL (`adoptCommittedOrStale`) before returning `STALE`, and compensation checks PostgreSQL before releasing. If the order exists, the entry is confirmed or adopted via `adoptOrder` — and if `adoptOrder` returns `NOT_ADOPTED` because the ledger is mid-rebuild (`!isIntact`), `confirmCommitted` throws a retryable error so BullMQ retries adoption once restore finishes. If PostgreSQL has no order, compensation releases the unit.

**Rejected.** Release on any failure. It is simpler, and wrong in exactly the case it exists for.

**Cost.** A compensation job needs PostgreSQL to answer. It retries 8 times, then the sweep retries it.

## 6. Retry for at least 5 minutes at a fixed 2 s step

**Why.** The buyers already have their 202, so the system owes them the order. A PostgreSQL restart is the likely fault, and it lasts seconds to minutes. 150 attempts 2 s apart cover at least 5 minutes, and a fixed step means recovery shows up within 2 s of PostgreSQL returning. An exponential step would wait longest just when the database is back.

The first version made 5 attempts with exponential backoff from 300 ms. On that code the `pg-blip` stress scenario, which stops PostgreSQL for 45 s, ended with 2 of 3 reservations never confirmed. The scenario was written to fail there, and it passes now.

**Rejected.** A deterministic failure (stock guard fails, sale row missing) never succeeds on retry, so it skips the budget and compensates after one attempt.

**Cost.** An outage longer than the budget withdraws the 202 and returns the unit. That is the chosen limit, because holding a unit forever for an order that cannot be written is worse.

## 7. Detect orphans with a periodic sweep

**Why.** If the process dies between the Lua step and `queue.add`, a `RESERVED` entry has no job. Closing that gap atomically would mean writing the BullMQ job from inside the script, which re-implements BullMQ's storage format in Lua. A transactional outbox would put a PostgreSQL write on the hot path, which removes the point of decision 1. So the gap is accepted and detected: every 30 s the sweep compares the `RESERVED` entries with the queue and compensates the ones with no job.

An entry is also jobless for a moment during normal traffic, so the sweep waits for a second sighting of the same order id (`INTERVAL`, threshold 2). At boot under `APP_ROLE=all`, nothing is in flight yet so it uses threshold 1 (`BOOT`); in split mode, `APP_ROLE=api` skips boot sweeping (`null`) and `APP_ROLE=worker` uses threshold 2 (`INTERVAL`) because live `api` replicas may already have checkouts in flight while a worker restarts.

**Cost.** In this rare case the unit stays held for 30 to 60 s. The buyer got a 503, so no order was promised.

## 8. Refusals are values, not exceptions

**Why.** At sold-out load, nearly every request is a refusal. A thrown exception captures a V8 stack trace, which is expensive at thousands of requests per second. The service returns a discriminated union, and the controller maps it to a status through a table typed `Record<PurchaseOutcome, HttpStatus>`. A new outcome without a status fails the build. Exceptions stay for faults (503) and bad input (400).

**Cost.** Every caller must handle the union. The type system enforces that, so the cost is a little more code.

## 9. A fail-fast, auto-pipelined Redis client

**Why.** When Redis is away, a client that buffers commands lets requests pile up in memory and answers late and all at once. The hot-path client has no offline queue, a 2 s command timeout and one retry per request, so the API answers 503 immediately and recovers when Redis does. Auto-pipelining batches commands from concurrent requests into one socket write.

The pipelining is the largest measured gain: against the same code without it, API CPU per request fell by 37% (350 to 222 µs), and Redis reads per `EVALSHA` fell from 0.9 to about 0.0 ([benchmarks.md](benchmarks.md)).

**Cost.** The worker keeps different options on purpose. A blocking read outlasts any command timeout, and a worker should wait out a reconnect and not fail. So the process holds three Redis connections with three behaviors.

## 10. The API's clock decides the sale window

**Why.** `ClockService` is the only caller of `Date.now()`, and the API passes the time into the script as `nowMs`. A test can run the real script at `startsAt - 1`, `startsAt`, `endsAt` and `endsAt + 1` and get a deterministic answer. With one API instance there is one clock.

**Cost.** With several instances, their clocks must agree. The change is small: read `TIME` inside the script. It is listed in [scaling.md](scaling.md).

## 11. One module owns every Redis key and format

**Why.** `RESERVED:<orderId>` is a wire format. If several files parsed it, a change would break them silently. `modules/sale-ledger` is the only code that builds a key (using Redis Cluster `{saleId}` hash tags so multi-key Lua scripts and `MULTI` pipelines stay on one slot), acquires/releases `flash_sale:{saleId}:maintenance_lock` (across boot, ticks, and resets), parses entries, or calls scripts, and callers get typed results. It depends only on the Redis connection, so checkout, orders, flash sales and admin can all import it without a cycle. A lint rule and a spec fail on a violation.

**Cost.** One more module, and a barrel that must stay small.

## 12. `APP_ROLE=all` by default, with `api`/`worker` split built in

**Why.** One container is simple to run and demo, and the worker is light: a measurement without HTTP load wrote 100 orders in 334 to 372 ms. The limit is the Node main thread at about 220 µs of CPU per request, whichever role it runs. Setting `APP_ROLE=api` and `APP_ROLE=worker` (preconfigured in `docker-compose.scaled.yml`) cleanly separates them via `AppModule.forRole(role)` and `Core` modules: `api` defaults its DB pool to `5` (`DATABASE_POOL_MAX` overrides `1–200`), registers no BullMQ consumer queue/processor, and hydrates on boot without ticks or boot sweeps; `worker` mounts only `/health` and `/metrics`; and queue resumption + resets fence through `flash_sale:{id}:maintenance_lock` (`worker` heals partial `api` resets via `restoreIfLost`).

**Cost.** Under the default `APP_ROLE=all`, the worker shares the event loop with the request path, which likely adds to the p99 tail during the order burst. Splitting into `api` + `worker` removes that contention ([scaling.md](scaling.md)).

## 13. Polling, with a server-corrected clock

**Why.** Polling needs no connection per open page. The status refreshes every 2 s (and immediately after a `202` reservation or confirmation/release), and the order every 1,000 ms (up to 30 attempts) in a `[userId, orderId]`-keyed watch session so retries start fresh. On the server side, singleflight micro-caches (`ProductsService` 60 s + `Cache-Control` + 5 s stale fallback backoff; `FlashSalesService` 200 ms `FOUND`-only cache + `no-store`) and `OrdersService`'s `readSlotWithLedgerState` check absorb read storms without querying PostgreSQL. The countdown uses the server's `serverTime` as its base, and `useEffectiveSaleState` schedules one boundary `setTimeout` instead of polling every 250 ms, so the sale opens on the server's second with zero idle re-renders. The server stays the judge: an early click gets `SALE_UPCOMING`.

**Cost.** Out-of-band status changes can be up to 2 s plus the 200 ms server snapshot cache old. When stock runs out elsewhere, Buy Now stays enabled until the next poll, and a click in that gap gets the 410 banner. Server-sent events would close the gap at the price of a connection per page.

## 14. Raw SQL for the hot writes, DDL in code

**Why.** The order insert, the stock guard and the sale reschedule are exact statements, and their behavior (`ON CONFLICT DO NOTHING`, `WHERE remaining_stock > 0`, a CTE that deletes and updates in one transaction) is the design. Writing them as SQL keeps that visible. TypeORM supplies the connection pool and the entity reads. The three tables are created with `CREATE TABLE IF NOT EXISTS` under an advisory lock, because a migration tool for one schema version is more machinery than the problem needs.

**Cost.** A schema change would need a migration tool.

## 15. Optional rate limiting and admin key; no buyer auth

**Why.** The brief says "a user identifier (for example, a username or email)", so the user id is a free-form string, normalized and validated. A production system would use an authenticated identity, and the one-per-buyer rule would key on that. The stress scenarios measure concurrency from one host, and an always-on limiter would turn that load into 429s, so `RATE_LIMIT_ENABLED` defaults to `false` and can be turned on per-IP (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, max `50,000` buckets with O(1) expired-slot eviction) on checkout and order-lookup routes. `RateLimitGuard` keys on Fastify's `request.ip`, controlled by strict boolean `TRUST_PROXY` (`false` in code/`.env.example` so spoofed `X-Forwarded-For` headers are ignored; `true` in Compose behind nginx).

**Cost.** Built-in `RateLimitGuard` uses per-process memory, so multi-replica deployments still need a shared edge or Redis rate limiter and bot protection. The reset endpoint is a demo tool, off by default in code (`ENABLE_ADMIN_ENDPOINTS=false`), turned on in `.env.example` and Compose, requires `Content-Type: application/json` (`415` CSRF guard) and `RateLimitGuard`, logs a startup warning if unauthenticated in `production`, and is optionally gated by `ADMIN_API_KEY` (`x-admin-key`, `401 UNAUTHORIZED`).

## 16. nginx keeps a connection pool to the API

**Why.** Node 24 accepts one pending connection per event-loop iteration. When a proxy opens a connection per request, the new connections queue behind the API's own work. `apps/web/nginx.conf` uses a named upstream with `keepalive 256`, `keepalive_requests 10000`, and HTTP/1.1, overwrites `X-Forwarded-For` and `X-Real-IP` with `$remote_addr` (preventing client header spoofing when `TRUST_PROXY=true`), adds gzip and security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`) on `location /` static responses without duplicating Fastify's API headers, and enforces explicit proxy timeouts (5 s connect, 15 s send/read). In an earlier measurement before the durability and hot-path work, an oversell run through nginx before the pool made the API accept 5,252 connections, doubled its CPU and failed the p95 budget at about 320 ms. With the pool, the API accepted 6 to 15 connections per run and p95 through nginx was 133 to 143 ms. On the current code, raising upstream `keepalive` from `64` to `256` (`keepalive_requests 10000`) and warming all 330 VUs behind the 5 s barrier eliminated the 1% TCP accept tail spikes (`realistic-mix.k6.js`, [benchmarks.md](benchmarks.md)).

The stress scripts open their connections with an untimed `GET /health` for the same reason, so the latency budgets measure purchases and not connection setup.

**Cost.** nginx must follow the API when Compose recreates its container. It uses Docker's DNS with a short cache, and answers 502 for a few seconds if it starts before the API resolves. Compose starts it only after the API is healthy.
