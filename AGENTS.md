# AGENTS.md — Engineering Standards, TDD Protocol & Architectural Guardrails

> **Repository guidance for AI coding agents:**
> Apply the relevant TDD, code quality, and architecture rules below to the work being performed. Follow higher-priority instructions and explicit user requests when they conflict with this guidance.

## 1. Package Manager & Workspace Rules (`pnpm 12.x` Exclusively)

1. **Exclusively Use `pnpm` (`12.x`):** Use **`pnpm` version `>=12.0.0 <13.0.0`** (e.g., `pnpm@12.22.0`) with `pnpm-workspace.yaml` for all dependency installations, script executions, and Docker builds.
   * Declare `"engines": { "node": ">=20.0.0", "pnpm": ">=12.0.0 <13.0.0" }` and pin an exact `"packageManager": "pnpm@12.x.x"` matching the installed `pnpm 12.x` binary in the root `package.json`.
2. **`pnpm 12` Workspace Strictness (`pnpm-workspace.yaml`):**
   * `pnpm 12` rejects unknown configuration keys in `pnpm-workspace.yaml` and enforces `strictDepBuilds: true` by default (`ERR_PNPM_IGNORED_BUILDS`).
   * Use `pnpm 12`'s **`allowBuilds`** map in `pnpm-workspace.yaml` (e.g., `allowBuilds: { esbuild: true, '@swc/core': true }`) to explicitly whitelist or block lifecycle build scripts. **Do NOT** use deprecated legacy keys such as `onlyBuiltDependencies` or `ignoredBuiltDependencies`.
3. **Forbidden Commands & Lockfiles:** **NEVER** invoke `npm` or `yarn` to install project dependencies. **NEVER** generate `package-lock.json` or `yarn.lock`. Commit and maintain a single root `pnpm-lock.yaml`.
4. **Workspace Filtering:** Execute package-scoped commands from the repository root using workspace filters:
   * `pnpm --filter @flash-sale/api <script>`
   * `pnpm --filter @flash-sale/web <script>`

## 2. Mandatory Test-Driven Development (Strict Red $\rightarrow$ Green $\rightarrow$ Refactor)

All production code across both Backend (`@flash-sale/api`) and Frontend (`@flash-sale/web`) **must** be developed strictly via **Test-Driven Development (TDD)**:

1. **The Iron Law of TDD:**
   * **NEVER** write production business logic, repository queries, Lua scripts, controllers, custom React hooks, or stateful UI components before writing an automated failing test that specifies the expected behavior.
   * **NEVER** batch "all implementation in one phase and all tests in a later phase." Every vertical slice or domain module must progress test-first.
2. **Mandatory 3-Step Micro-Cycle (Execute & Observe in Terminal):**
   * **Step 1 — RED (Failing Test First):**
     1. Define only the minimal contracts needed to compile (`interfaces/`, `constants/`, `dto/`, or method signatures throwing `new Error('Not implemented')`).
     2. Write focused unit or integration test cases (`*.spec.ts` / `*.spec.tsx` / `*.e2e-spec.ts`) covering happy paths, boundary conditions, validation errors, and concurrency/failure scenarios.
     3. **Run the test runner immediately** and confirm the new test **FAILS** for the expected behavioral assertion (never skip running the failing test).
   * **Step 2 — GREEN (Minimal Passing Code):**
     1. Write the cleanest, minimal production implementation required to make the failing test(s) pass without breaking existing suites.
     2. **Re-run the test runner immediately** and confirm **100% GREEN**.
   * **Step 3 — REFACTOR (Clean Code Alignment):**
     1. Eliminate duplication where useful, review file/function size targets, and verify layer boundaries while keeping relevant tests **GREEN**.
3. **Testing Standards & Hygiene:**
   * Follow the **Arrange -- Act -- Assert (AAA)** pattern in every `it()` block with descriptive behavioral names (`it('returns ALREADY_PURCHASED when normalized userId already holds a reservation', ...)`).
   * Keep each test independent, deterministic, and isolated—never rely on wall-clock `setTimeout` sleeps when fake timers or injected `ClockService` providers can test time windows deterministically.
   * Test **observable behavior and public contracts**, not private methods or internal implementation details.

## 3. Quantitative Clean Code Limits (Anti-Bloat Guardrails)

Keep files, classes, and functions focused. The limits below are targets, not hard requirements: allow a justified exception when splitting or wrapping code would reduce clarity or add unnecessary complexity. Record the reason when an exception is material.

1. **File Length Limit:**
   * Target $\le 150$ **lines** per production source file; review threshold is $220$ **lines** (automated test files should also stay modular, targeting $\le 250$ lines per spec file by splitting suites per class/hook).
   * If a source file approaches $200$ lines, consider splitting responsibilities into focused collaborators, helpers, or sub-components during the **REFACTOR** step when it improves clarity.
2. **Function / Method Length Limit:**
   * Target $\le 25$ **lines**; review threshold is $40$ **lines** per function or method.
   * Each function must operate at a **single level of abstraction**.
3. **Parameter Count Limit:**
   * Target at most $3$ **positional parameters** per function/method (excluding NestJS constructor Dependency Injection).
   * If $4+$ inputs are required, consider grouping them into a named `interface` parameter object (e.g., `ReserveInventoryParams`).
4. **Nesting Depth & Guard Clauses:**
   * Target at most $2$ **levels** of nesting inside a function.
   * Enforce **Early Returns / Guard Clauses** at the top of functions. Avoid `else` / `else if` chains when an early `return` expresses the flow cleanly.
5. **Single Class / Component Per File:**
   * Never declare multiple NestJS services, controllers, entities, DTOs, or stateful React components in the same file.

## 4. Strict Layering & File Organization (Backend — NestJS)

Every domain module inside `apps/api/src/modules/<domain>/` must separate responsibilities strictly across dedicated directories and files:

```text
modules/<domain>/
├── <domain>.module.ts                 # Module wiring & explicit exports only
├── controllers/
│   └── <domain>.controller.ts         # Thin HTTP transport adapter ONLY
├── services/
│   └── <domain>.service.ts            # Pure business orchestration & domain logic
├── repositories/
│   ├── <domain>.repository.ts         # PostgreSQL queries & ACID transactions
│   └── <domain>-cache.repository.ts   # Redis keys, pipelines & Lua script calls
├── processors/                        # (Only if module consumes BullMQ jobs)
│   └── <job-name>.processor.ts        # Thin queue worker delegating to a Service
├── dto/
│   ├── <action>.request.dto.ts        # Input validation (class-validator)
│   └── <action>.response.dto.ts       # Typed HTTP output contract
├── entities/
│   └── <entity>.entity.ts             # TypeORM persistence mapping ONLY
├── interfaces/
│   └── <domain>.interface.ts          # Domain models, params & discriminated unions
└── constants/
    └── <domain>.constants.ts          # TTLs, Redis prefixes, limits, error codes
```

### Layer Responsibility Rules (Non-Negotiable)

* **Controllers (`*.controller.ts`):**
  * Handle routing, HTTP status codes, and DTO binding **only**.
  * **FORBIDDEN in Controllers:** `if/else` business branching, data transformations beyond response mapping, or direct injection of TypeORM repositories, `DataSource`, `Redis`, or BullMQ `Queue`.
* **Services (`*.service.ts`):**
  * Orchestrate domain workflows using injected Repositories, sibling module Services, and Queue producers.
  * **FORBIDDEN in Services:** Raw SQL queries, TypeORM `QueryBuilder`, raw Redis commands (`HGET`, `HSET`, `EVALSHA`), or hardcoded magic strings/numbers.
  * **High-Throughput Error Strategy:** Do **NOT** throw exceptions for expected high-frequency business outcomes under load (e.g., `SOLD_OUT`, `ALREADY_PURCHASED`, `SALE_ENDED`) inside Services—stack trace capture in V8 is expensive at $10,000\text{ req/s}$. Return **typed discriminated unions** from Services and map them cleanly to HTTP status codes at the Controller/Response boundary. Reserve exceptions for unexpected infrastructure faults (`503`) or invalid client input (`400`).
* **Repositories (`*.repository.ts` & `*-cache.repository.ts`):**
  * Own all SQL queries, DB transactions, Redis pipelines, and Lua script executions.
  * **Encapsulate Storage Formats:** Never leak raw Redis wire formats (such as `"RESERVED:uuid"`) outside `*-cache.repository.ts`. Parse and return strongly typed domain objects (`{ status: OrderState.RESERVED, orderId: string }`).
* **Constants (`*.constants.ts`):**
  * **Zero Magic Values:** Every timeout, cache TTL, retry count, regex pattern, queue name, DI injection token, and Redis key builder function must live in `constants/`.
* **Interfaces & Types (`*.interface.ts`):**
  * Never inline complex object types inside service signatures. Place shared domain types, enums/union literals, and method contracts inside `interfaces/`.
* **Module Dependency Acyclicity:**
  * The module graph must remain a strict **Directed Acyclic Graph (DAG)**.
  * **`forwardRef()` is strictly forbidden.** If two modules appear to need each other, extract the shared contract or move orchestration up to a higher-level module (`CheckoutModule` or `AdminModule`).

## 5. Strict Modular Architecture (Frontend — React + TypeScript + Tailwind)

Organize `apps/web/src/` by **Domain Feature Modules**, with co-located `__tests__/` suites driven via Vitest + React Testing Library:

```text
apps/web/src/
├── app/                               # App shell, root layout, global error boundary
├── shared/                            # Reusable UI primitives, typed HTTP client, utils
│   ├── api/
│   ├── components/
│   ├── constants/
│   ├── types/
│   └── utils/
└── modules/
    └── <feature>/                     # e.g., product, flash-sale, checkout, orders, simulation
        ├── __tests__/                 # TDD unit/component/hook specs (*.spec.ts / *.spec.tsx)
        ├── api/<feature>.api.ts       # Pure async HTTP calls for this domain
        ├── components/*.tsx           # Focused UI components (target <= 120 lines each)
        ├── hooks/use-*.ts             # State machines, polling, timers, mutations
        ├── types/<feature>.types.ts   # Domain interfaces & API response types
        ├── constants/<feature>.constants.ts
        └── index.ts                   # Public barrel export for cross-module consumption
```

### Frontend Clean Code & TDD Rules

1. **Test Hooks & Components Before Implementation:** Write Vitest + `@testing-library/react` (`renderHook` / `render`) specs first for timer offset math, polling lifecycles, disabled button rules, and contextual feedback banners before implementing the hook or JSX.
2. **Zero Side-Effects in Presentational JSX:** Components must not call `fetch`, construct URLs, or manage raw `setInterval`/`setTimeout` timers directly. Extract all async lifecycles, server-clock offset math, and polling loops into dedicated hooks (`hooks/use-*.ts`).
3. **Module Encapsulation:** Cross-module imports must import **only** from a sibling module's public `index.ts` barrel (`@/modules/orders`), never reaching into internal paths (`@/modules/orders/hooks/...`).
4. **Explicit UI States:** When an interactive view has asynchronous or otherwise meaningful lifecycle states, model the applicable states explicitly; use discriminated unions where they make the state transitions clearer.

## 6. TypeScript Strictness & Naming Conventions

1. **Strict Compiler Flags:** `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
2. **Zero `any` Policy:** Usage of `any` is strictly prohibited across `src/` and `test/`. Use `unknown` with type guards or explicit typed mocks/generics.
3. **Explicit Return Types:** Every exported function, class method (public or private), custom React hook, and API client function must declare an explicit TypeScript return type.
4. **Consistent Naming:**
   * **Files & Directories:** `kebab-case` on Backend (`flash-sales.service.ts`, `order-cache.repository.ts`); `PascalCase.tsx` for React components and `kebab-case.ts` for hooks/utilities (`use-flash-sale-status.ts`) on Frontend.
   * **Booleans:** Prefix with auxiliary verbs (`isSoldOut`, `hasPurchased`, `canAttemptPurchase`).
   * **Constants:** `UPPER_SNAKE_CASE` (`STATUS_MICRO_CACHE_TTL_MS`, `ORDER_PERSISTENCE_QUEUE`).
   * **Interfaces & Types:** `PascalCase` without Hungarian `I` prefixes (`FlashSaleSummary`, **not** `IFlashSaleSummary`).

## 7. High-Throughput & Concurrency Hygiene

1. **Event Loop Protection:** Never call synchronous I/O or `console.log` in hot request paths. Use injected NestJS/Pino structured loggers at appropriate levels (`warn`/`error` for exceptional states, never `info` per purchase attempt in production/stress mode).
2. **Clock Injection for Deterministic TDD:** Never hardcode `Date.now()` deep inside domain services when evaluating sale time windows; encapsulate clock access via an injectable `ClockService` so TDD unit tests verify boundary timestamps (`startsAt - 1`, `startsAt`, `endsAt`, `endsAt + 1`) deterministically.
3. **Resource Cleanup:** Every `OnModuleDestroy` in custom Redis clients, BullMQ queues/workers, and intervals must close connections gracefully so Jest/Vitest test suites exit cleanly without leaked handles.

## 8. Self-Verification Checklist

After each TDD slice, run the relevant tests and checks. Before completing an implementation change, run the full applicable checks below when the workspace and scripts exist. If a check cannot run, report why rather than claiming it passed.

* [ ] `pnpm --version` confirms **`12.x.x` (`>=12.0.0 <13.0.0`)** and `pnpm-workspace.yaml` uses valid `pnpm 12` schema (`allowBuilds`).
* [ ] Every feature slice followed **RED $\rightarrow$ GREEN $\rightarrow$ REFACTOR** (failing spec observed prior to implementation).
* [ ] `pnpm -r test` (Backend Jest + Frontend Vitest) passes with **100% green suites**.
* [ ] `pnpm -r lint` passes with **0 warnings and 0 errors**.
* [ ] `pnpm -r typecheck` (`tsc --noEmit`) passes cleanly.
* [ ] `pnpm -r build` succeeds for all workspace packages.
* [ ] Review source files over $220$ lines and functions over $40$ lines; document material exceptions when splitting would reduce clarity.
* [ ] Zero `any` types, zero `forwardRef()`, zero business logic in Controllers, and zero raw SQL/Redis calls inside Services.