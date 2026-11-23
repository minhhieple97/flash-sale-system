[← README](../README.md)

# Purchase flow

This page follows one purchase from the click to the PostgreSQL row, one stage at a time. Each stage has its own diagram. Failures of each stage are in [fault-tolerance.md](fault-tolerance.md).

## The whole path

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant N as nginx
    participant A as API
    participant R as Redis
    participant W as Worker
    participant P as PostgreSQL

    B->>N: POST /api/v1/checkout/purchase {userId}
    N->>A: proxy on a pooled connection
    A->>A: trim and lowercase userId, create orderId
    A->>R: EVALSHA attemptPurchase
    Note over R: one script: resend, window, duplicate, stock<br/>DECR stock, HSET users RESERVED:orderId
    R-->>A: RESERVED
    A->>R: queue.add persist-order, jobId = orderId
    A-->>B: 202 {code RESERVED, orderId}
    R-->>W: job
    W->>R: HGET users userId (still this orderId?)
    W->>P: BEGIN, INSERT order, UPDATE stock WHERE remaining_stock above 0, COMMIT
    W->>R: confirmPurchase (RESERVED to CONFIRMED)
    loop every 1,000 ms, at most 30 times
        B->>N: GET /api/v1/orders/user/:userId
        N->>A: proxy on pooled connection
        A->>R: MULTI (HGET users, EXISTS config stock)
        Note over A,P: PG lookup only if slot=NONE and ledger not intact
        A-->>B: RESERVED, then CONFIRMED
    end
```

The request ends at step 7. The buyer waits for Redis twice (the script, the enqueue) and never for PostgreSQL. Steps 8 to 11 happen after the answer, which is why the HTTP status is 202 Accepted and not 201 Created: the reservation is accepted, and the order is not yet written.

## Stage 1: the user id

The controller binds `userId` through one pipe. The pipe trims and lowercases the value, then checks that it is 3 to 128 characters of `a-z`, `0-9`, `.`, `_`, `@`, `+` or `-`. A bad value answers 400 `INVALID_USER_ID`. A good value becomes a `NormalizedUserId`, a branded string type, and a raw `string` cannot reach a service or repository without a compile error.

So `" Alice@Example.com "` and `alice@example.com` are one buyer. Without this step, a buyer could take a second unit by changing the case of an email. The `same-user-race` stress scenario sends 300 requests in four spellings of one id and expects exactly one 202, and the end-to-end suite does the same with 50 requests.

## Stage 2: the gate

`attemptPurchase` is one Lua script. Redis runs scripts one at a time, so everything below happens with no other command in between.

```mermaid
flowchart TD
    start(["attemptPurchase(userId, nowMs, orderId)"]) --> resend{"entry is RESERVED:orderId?"}
    resend -- yes --> r1(["RESERVED<br/>a resend of the same reservation"])
    resend -- no --> cfg{"config hash exists?"}
    cfg -- no --> nc1(["SALE_NOT_CONFIGURED, 503"])
    cfg -- yes --> up{"nowMs before startMs?"}
    up -- yes --> u(["SALE_UPCOMING, 422"])
    up -- no --> en{"nowMs after endMs?"}
    en -- yes --> e(["SALE_ENDED, 422"])
    en -- no --> dup{"buyer has an entry?"}
    dup -- yes --> d(["ALREADY_PURCHASED, 409"])
    dup -- no --> sk{"stock key exists?"}
    sk -- no --> nc2(["SALE_NOT_CONFIGURED, 503"])
    sk -- yes --> st{"stock above 0?"}
    st -- no --> so(["SOLD_OUT, 410"])
    st -- yes --> take["DECR stock<br/>HSET users userId RESERVED:orderId"] --> r2(["RESERVED, 202 after the enqueue"])
```

The order of the checks is part of the contract, and each step has a spec.

- **The resend check is first.** If a Redis client resends the command after a lost reply, it carries the same `orderId`, and the answer is `RESERVED` again with no second `DECR`. This holds even after the sale ended.
- **The window is inclusive at both ends.** A request at `startMs` or `endMs` is accepted. The API passes its own clock time in as `nowMs`. An integration spec runs the real script at `startsAt - 1`, `startsAt`, `endsAt` and `endsAt + 1`, and expects `SALE_UPCOMING`, `RESERVED`, `RESERVED` and `SALE_ENDED`.
- **A sold-out sale reports `SALE_ENDED` once it is over**, and a buyer who holds a unit gets `ALREADY_PURCHASED` before `SOLD_OUT`. Both orders are tested.
- **A missing key is not zero.** A missing config hash or stock key means Redis lost state. It answers `SALE_NOT_CONFIGURED`, which the API turns into 503, and never a false `SOLD_OUT`.

Expected refusals are returned as values, not thrown. At sold-out load most requests are refusals, and a thrown exception captures a V8 stack trace for each one. `CheckoutService.attemptPurchase` returns a discriminated union, and the controller maps it through a table typed `Record<PurchaseOutcome, HttpStatus>`. Adding an outcome without a status fails the build.

## Stage 3: the enqueue

After `RESERVED`, the API adds one job. The job id is the order id. BullMQ refuses custom ids that contain `:`, so `saleId:userId` cannot work, and the order id is unique per reservation, so the same buyer can buy again after a reset without hitting an old job.

If `queue.add` throws, the answer may still be unknown: the job may be stored and only the reply lost.

```mermaid
flowchart TD
    add["queue.add persist-order<br/>jobId = orderId, 150 attempts, 2 s apart"] -->|"ok"| queued(["QUEUED, answer 202"])
    add -->|"throws"| stored{"queue.getJob(orderId)<br/>finds the job?"}
    stored -- yes --> queued
    stored -- "no, or the lookup failed" --> release["rollbackPurchase<br/>only while the entry is RESERVED:orderId"]
    release -- RELEASED --> released(["RELEASED, answer 503"])
    release -- NOT_RESERVED --> slot{"entry is CONFIRMED?"}
    slot -- yes --> queued
    slot -- no --> released
```

The reservation is kept only when the job is known to exist or the order is already confirmed (a finished job is removed from the queue, so its confirmed entry is the proof). In every other case the unit goes back and the buyer sees 503 `TEMPORARY_FAILURE`. A job that was stored after all finds its entry gone and writes nothing.

## Stage 4: the worker

The worker takes jobs with concurrency 20. For each job it runs `persistReservedOrder`.

```mermaid
flowchart TD
    job["persist-order job"] --> live{"entry holds this orderId?<br/>RESERVED or CONFIRMED"}
    live -- no --> pgCheck{"PostgreSQL holds<br/>this exact orderId?"}
    pgCheck -- no --> stale(["STALE: write nothing, job done"])
    pgCheck -- yes --> adopt["confirmCommitted (adopt into Redis)<br/>returns ALREADY_PERSISTED"]
    live -- yes --> ins["PostgreSQL transaction:<br/>INSERT order FROM the sale row<br/>ON CONFLICT (sale, user) DO NOTHING"]
    ins -- "row inserted" --> dec{"UPDATE remaining_stock - 1<br/>WHERE remaining_stock above 0<br/>updated one row?"}
    dec -- yes --> inserted["INSERTED"]
    dec -- no --> rej1["roll back, reject:<br/>STOCK_INVARIANT_VIOLATION"]
    ins -- "no row inserted" --> ex{"an order for (sale, user)<br/>already exists?"}
    ex -- yes --> already["ALREADY_PERSISTED<br/>with the stored order id"]
    ex -- no --> rej2["reject: SALE_NOT_FOUND"]
    inserted --> confirm["confirm the entry"]
    already --> confirm
    rej1 --> comp(["UnrecoverableError:<br/>compensate at once"])
    rej2 --> comp
```

| Outcome | Meaning | What the worker does next |
| --- | --- | --- |
| `STALE` | The reservation was released or reset before the job ran, and PostgreSQL does not hold `orderId` | Nothing. The job completes |
| `INSERTED` | The order is new and stock was decremented in the same transaction | Confirms the entry |
| `ALREADY_PERSISTED` | An order for this buyer already exists in PostgreSQL (including when `!isReservationLive` after a Redis flush matches `orderId`) | Confirms or adopts the entry with the stored order id |
| A rejection | The two cases that can never succeed: the stock guard failed, or the sale row is missing | Fails the job at once as unrecoverable, and compensation takes over |
| Any other error (connection refused, statement timeout, deadlock) | A fault that may pass | Throws, and BullMQ retries 2 s later, up to 150 attempts |

The insert takes `product_id` from the sale row, so the job carries only the reservation identity. The stock decrement runs only for a fresh insert, which is why a retried job cannot decrement twice.

### Confirming the entry

```mermaid
flowchart TD
    c["confirmPurchase<br/>CONFIRMED:storedId, only while the entry is RESERVED:orderId"] -- CONFIRMED --> done(["entry is CONFIRMED"])
    c -- NOT_RESERVED --> a["adoptOrder<br/>entry absent and stock key exists (even <= 0):<br/>write CONFIRMED, DECR stock"]
    a -- ADOPTED --> warn(["entry is CONFIRMED, warning logged:<br/>committed after its entry was lost"])
    a -- NOT_ADOPTED --> intact{"ledger intact?<br/>(config & stock exist)"}
    intact -- no --> retry(["throw retryable error:<br/>ledger rebuilding; BullMQ retries"])
    intact -- yes --> err(["error logged:<br/>committed but cannot be confirmed or adopted"])
```

`confirmPurchase` is a compare-and-set: it writes only over the exact `RESERVED:<orderId>` the job was created for. So a reservation that was released can never come back as `CONFIRMED`. If the order committed but its Redis entry vanished (for example during a Redis flush or chunked restore), `adoptOrder` puts the entry back and takes the unit; if `adoptOrder` sees missing ledger keys while `restoreIfLost` is mid-rebuild, `confirmCommitted` throws a retryable error so BullMQ retries adoption once the ledger is intact.

## The life of a buyer's entry

```mermaid
stateDiagram-v2
    [*] --> RESERVED: attemptPurchase, stock minus 1
    RESERVED --> CONFIRMED: confirmPurchase after the commit
    RESERVED --> [*]: rollbackPurchase (stock + 1) or admin reset
    [*] --> CONFIRMED: adoptOrder, restoreConfirmedBatch, or restoreSale
    CONFIRMED --> [*]: admin reset
```

A reservation is released when the enqueue fails and the job does not exist, when compensation finds no order in PostgreSQL, when the sweep finds a reservation with no job, or when an admin reset wipes the sale.

## Reading the result

### Sale status

`GET /api/v1/flash-sales/current` reads the config hash and the stock key in one `MULTI` and computes the state from the server clock.

```mermaid
stateDiagram-v2
    [*] --> UPCOMING
    UPCOMING --> ACTIVE: now reaches startsAt
    ACTIVE --> SOLD_OUT: stock reaches 0
    SOLD_OUT --> ACTIVE: a unit is released
    ACTIVE --> ENDED: now passes endsAt
    SOLD_OUT --> ENDED: now passes endsAt
```

The checks run in the order `UPCOMING`, `ENDED`, `SOLD_OUT`, `ACTIVE`. Only `FOUND` Redis `SnapshotRead` promises (with `remainingStock` clamped `>= 0`) are micro-cached for 200 ms with singleflight coalescing, while `serverTime` and `saleState` are computed fresh per request from `ClockService` (so window transitions flip immediately). Non-`FOUND` reads are never cached: when Redis holds no config (`NOT_CONFIGURED`), `FlashSalesService` checks PostgreSQL and answers `503 TEMPORARY_FAILURE` if PostgreSQL holds a campaign (or is unavailable), returning `404 FLASH_SALE_NOT_FOUND` only when neither store has one; missing stock with config present answers `503 TEMPORARY_FAILURE`.

### Order lookup

`GET /api/v1/orders/user/:userId` emits `Cache-Control: no-store` and reads the user's slot and whether the ledger keys (`:config` and `:stock`) exist in one Redis `MULTI` (`readSlotWithLedgerState`). While the ledger is intact, a missing slot returns `NONE` directly from Redis without hitting PostgreSQL (cache-penetration guard); only when ledger keys are missing does lookup fall back to PostgreSQL.

```mermaid
flowchart TD
    q["lookup(userId)"] --> slot{"entry in the users hash"}
    slot -- RESERVED --> r(["RESERVED, with orderId"])
    slot -- CONFIRMED --> c(["CONFIRMED, with orderId"])
    slot -- none --> intact{"config and stock keys intact?"}
    intact -- yes --> n(["NONE without PG query"])
    intact -- no --> pg{"PostgreSQL has an order<br/>for (sale, user)?"}
    pg -- yes --> c2(["CONFIRMED, with the stored orderId"])
    pg -- no --> n2(["NONE"])
```

`NONE` after a 202 means the reservation was released. The storefront shows that as "Reservation released". When `RATE_LIMIT_ENABLED=true`, both `POST /checkout/purchase` and `GET /orders/user/:userId` enforce the per-IP `RateLimitGuard` (`429 RATE_LIMITED`), keying by `request.ip` governed by `TRUST_PROXY` (`false` default; `true` in Compose behind nginx's `X-Forwarded-For $remote_addr`).

## In the browser

`UserIdField` validates format inline (`3–128 characters: a–z, 0–9, . _ @ + -`), and "Buy Now" is locked while the sale is not `ACTIVE` on the server-corrected clock (via `useEffectiveSaleState`'s boundary-scheduled `setTimeout`), while a request is in flight, and while the user id is blank. After a 202 (and again on confirmation or release), the checkout card triggers an immediate sale status refresh and starts a fresh `[userId, orderId]`-keyed polling session (`useOrderConfirmationPoller`, 1,000 ms × 30 attempts).

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> polling: 202 RESERVED
    polling --> polling: RESERVED, or a failed poll
    polling --> confirmed: CONFIRMED with an orderId
    polling --> released: NONE, the reservation was rolled back
    polling --> timedOut: 30 polls without an answer, about 30 s
    confirmed --> [*]
    released --> [*]
    timedOut --> [*]
```

| Answer | Banner title | Tone |
| --- | --- | --- |
| 202 `RESERVED` | Reserved! Confirming your order... | info |
| then `CONFIRMED` | Order confirmed | success |
| then `NONE` | Reservation released | warning |
| after 30 polls | Still confirming | info |
| 409 `ALREADY_PURCHASED` | Already purchased | warning |
| 410 `SOLD_OUT` | Sold out | danger |
| 422 `SALE_UPCOMING` | Sale has not started | info |
| 422 `SALE_ENDED` | Sale has ended | neutral |
| 400 `INVALID_USER_ID` | Invalid user ID | warning |
| 429 `RATE_LIMITED` | Too many requests. Please wait a moment and try again. | warning |
| 503 `TEMPORARY_FAILURE` | Temporarily unavailable | danger |

The table is typed `satisfies Record<FeedbackCode, ...>` over the web module's `FeedbackCode` union so every known frontend code has a banner; any unlisted backend code falls back to `FALLBACK_PURCHASE_FEEDBACK` (`"Purchase failed"`).
