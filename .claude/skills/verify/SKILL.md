---
name: verify
description: Verify the flash-sale monorepo (NestJS Fastify API under /api/v1, React storefront, Postgres + Redis in Docker). Use after every RED-GREEN-REFACTOR slice and before reporting any slice, phase gate, or delegated change done; run the static gate (`pnpm verify`) and, for behavior changes, launch the real API + web, drive the affected feature from features/, and capture evidence.
---

# Verify the flash-sale monorepo

Two layers. The **gate** proves the code is healthy. The **drive** proves the running app does what a user sees. A slice is done only when the gate prints `VERIFY OK` and every feature the slice touched was driven with evidence.

Helpers live in `.claude/skills/verify/bin/`. Run them from the repo root. All are executable.

`pnpm verify`, `launch.sh` and `ui.sh` need Node 24 or later first on `PATH` (`nvm use` reads `.nvmrc`). This machine's default shell has Node 18, where pnpm stops with `ERR_PNPM_BAD_RUNTIME_VERSION` (the root `devEngines.runtime`). `launch.sh` and `ui.sh` refuse up front and name the version they found.

## Gate

```bash
pnpm verify          # = bash .claude/skills/verify/bin/gate.sh
```

| Check | Command |
|---|---|
| containers | postgres and redis compose services report `healthy` |
| lint | `pnpm lint` from the root: `biome check --error-on-warnings .` plus `scripts/verify-agent-limits.mjs`, both over `apps/`, `scripts/` and `tests/` |
| checker tests | `pnpm test:scripts` (`node --test scripts/*.test.mjs`, the agent-limits checker's own suites) |
| typecheck | `pnpm -r typecheck` |
| compose api stopped | fails when `docker compose ps -q --status running api` is non-empty; run `docker compose stop api web` |
| api tests | `pnpm --filter @flash-sale/api exec jest --detectOpenHandles` under a 300 s `timeout` (no `--forceExit`, so a hang fails the step), failed if Jest reports any open handle. Runs both Jest projects: `unit` (no infrastructure) and `integration` (the compose postgres and redis, configured from the root `.env`) |
| web tests | `pnpm --filter @flash-sale/web test` (Vitest) |
| build | `pnpm -r build` |

One `PASS`/`FAIL` line per check, then `VERIFY OK` (exit 0) or `VERIFY FAILED: <checks>` (exit 1). A failure prints the last 30 log lines and the log path. Quote the PASS/FAIL lines in your report.

## Launch

```bash
.claude/skills/verify/bin/launch.sh
```

1. Refuses if `node` on `PATH` is older than 24, if `.verify-run/` exists, or if a target port is already bound (by anything).
2. `docker compose up -d postgres redis`, waits until both are `healthy`.
3. Builds the API (a failed build prints the tail of `.verify-run/api-build.log`), starts `node apps/api/dist/main.js` with `PORT=$VERIFY_API_PORT` (default `3100`).
4. Starts Vite dev for the web on `127.0.0.1:$VERIFY_WEB_PORT` (default `5180`, `--strictPort`) with `VITE_API_PROXY_TARGET=$API_URL`, so the page's relative `/api` and `/health` calls reach this run's API the same way nginx proxies them in Docker.
5. Ready means usable. The API answers `GET /health` (outside the `/api/v1` prefix) with 2xx, which requires both `SELECT 1` and Redis `PING` to succeed. Nest runs every `OnModuleInit`, including `SchemaConstraintsInitializer`, before it listens, so a 2xx also means the schema and its constraints exist. The web serves the page with `<div id="root">`.
6. Prints `READY run=<id> api=<url> web=<url> evidence=<dir>`.

Verification runs on 3100 and 5180, never on the compose stack's default ports (3000 for the API, 8080 for the web), so a stack already published there is left alone. Each process runs in its own process group recorded in `.verify-run/{api,web}.pgid`, with logs in `.verify-run/*.log`.

Phase 3 hydration runs in `OnApplicationBootstrap`, also before listen, so the same `/health` wait covers it. If seeding ever moves off the boot path, extend `launch.sh` to wait for it and say so here.

## Doctor

```bash
.claude/skills/verify/bin/doctor.sh
```

Read-only. Checks that postgres and redis are healthy, that each port's listener is in the process group this skill started, that both endpoints answer, and that the API build is not older than `apps/api/src`. It also prints the git rev and dirty count. Run it first whenever anything looks off. Exit 0 means the instance is worth driving.

## Drive

Read [features/README.md](features/README.md), then follow the matching feature file.

```bash
.claude/skills/verify/bin/http.sh <feature> <name> <METHOD> <path> [json-body]   # API call, records request/headers/body
.claude/skills/verify/bin/browser.sh <feature> <name> <path-or-url>              # headless Chrome: rendered DOM + screenshot
.claude/skills/verify/bin/ui.sh <feature> <name> '<steps-json>'                  # Playwright: click, type, assert, capture
```

`browser.sh` runs `google-chrome --headless=new` with a throwaway profile. `--dump-dom` captures the DOM after React renders, so a heading present there and absent from `index.html` proves client rendering. It cannot click or type.

`ui.sh` drives the storefront through `playwright-core` (a pinned web devDependency) on the system Chrome. It needs Node 24 or later on `PATH`, which `nvm use` provides. It runs a JSON array of steps in order, one key per step:

| Step | Effect |
|---|---|
| `{"clockSkewMs": n}` | shifts the page's `Date` by `n` ms while timers keep running. Put it before `goto` |
| `{"goto": "/"}` | opens a path on the web URL |
| `{"click": {"name", "role"?, "in"?}}` | clicks by role (default `button`) and exact accessible name |
| `{"fill": {"label", "value", "in"?}}` | types into the field with that exact label |
| `{"expect": {"text", "exact"?, "in"?, "timeoutMs"?}}` | waits until the text is visible (default 10 s, substring unless `exact`) |
| `{"disabled": {"name", "value"?, "in"?}}` | waits until the button's disabled state equals `value` (default `true`) |
| `{"snap": "name"}` | full-page DOM + screenshot |
| `{"scrollSnap": "name"}` | viewport screenshot after scrolling to the bottom |

`in` scopes a step to the region with that accessible name. The storefront's regions are `Sale status`, `Checkout` and `Order lookup`. The run writes `<name>.steps.log` with one `PASS`/`FAIL` line per step, every page error, console error and HTTP response of 400 or above. A journey that provokes a 4xx on purpose (`buy-duplicate`, `lookup-invalid`) logs that `HTTP` line and a matching `CONSOLE-ERROR`: that is the response being proved, not a failure. It also writes `<name>.dom.html` and `<name>.png`, or a `<name>.failure.*` capture at the failing step, and it exits 1 on failure.

## Evidence

Artifacts go to `.verify-evidence/<run-id>/<feature>/` (gitignored) and survive cleanup. Cleanup also copies the run's logs into `.verify-evidence/<run-id>/`.

Proof standards:
- Drive the real user path: public HTTP routes and the rendered page. Never call services directly or add test-only endpoints.
- Capture the action and the resulting state. For a mutation, add a second read-only view of the stored state: the user lookup endpoint, and for stock or orders a `psql` or `redis-cli` read via `docker compose exec`.
- Use mocks only where a production boundary already isolates the external system.
- Report each feature ID and entry point you drove. A path you could not reach is reported with the command and the unmet precondition, never as verified through a different path.

## Isolation

API and web instances isolate by port (`VERIFY_API_PORT`, `VERIFY_WEB_PORT`). By default Postgres and Redis do not isolate: there is one compose project (`flash-sale`) and one database. Two concurrent runs that reset the sale or purchase stock corrupt each other's results. Do not drive mutating features in parallel. Do not touch containers outside the compose project you are driving. The compose `api` container runs a BullMQ worker on the same queue as the jest integration suites, so stop it (`docker compose stop api web`) before running the gate. The gate enforces this with the `compose api stopped` check.

When another session is using the shared stack (its api container is up, or a stress run is going), do not stop it and do not reset its sale. Run on a private compose project instead:

```bash
export COMPOSE_PROJECT_NAME=flash-sale-audit POSTGRES_PORT=55432 REDIS_PORT=56379 PORT=3101 WEB_PORT=8181
```

Values in the environment beat the root `.env` and the compose file's `name:`. With them exported, `launch.sh`, `doctor.sh`, `pnpm verify`, every `docker compose` command in `features/` and `pnpm stress:*` act on a project with its own Postgres, Redis, volumes, queue and api container, and the feature files' ports 3001 and 8080 are `PORT` and `WEB_PORT`. The gate's `compose api stopped` check then looks at that project, whose queue the suites share. Tear it down with `docker compose down -v --rmi local`, which removes only that project. On 2026-11-21 the whole gate, every feature and the stress suite ran this way while the shared stack stayed up.

## Cleanup

```bash
.claude/skills/verify/bin/cleanup.sh
```

Kills only the process groups recorded in `.verify-run/` and removes that directory. Keeps `.verify-evidence/`. It leaves postgres and redis running, because the gate and other work share them. Run cleanup after every run, failed iterations included.

## Rules

- Do not weaken a check or a journey to get green. A `verify-agent-limits` size violation is fixed by splitting, or by an `// agent-limits-allow <rule>: <reason>` marker when splitting would reduce clarity (AGENTS.md section 3).
- A Jest open-handle failure is fixed by closing the app, client, queue, or timer in `afterAll` or `OnModuleDestroy`. Never drop the flag.
- When a phase adds suites (integration, e2e, build) or user-facing features, extend `gate.sh` and `features/` in the same change.
