---
name: verify
description: Verify the flash-sale monorepo (NestJS Fastify API under /api/v1, React storefront, Postgres + Redis in Docker). Use after every RED-GREEN-REFACTOR slice and before reporting any slice, phase gate, or delegated change done; run the static gate (`pnpm verify`) and, for behavior changes, launch the real API + web, drive the affected feature from features/, and capture evidence.
---

# Verify the flash-sale monorepo

Two layers. The **gate** proves the code is healthy. The **drive** proves the running app does what a user sees. A slice is done only when the gate prints `VERIFY OK` and every feature the slice touched was driven with evidence.

Helpers live in `.claude/skills/verify/bin/`. Run them from the repo root. All are executable.

## Gate

```bash
pnpm verify          # = bash .claude/skills/verify/bin/gate.sh
```

| Check | Command |
|---|---|
| containers | postgres and redis compose services report `healthy` |
| lint | `pnpm -r lint` (Biome `--error-on-warnings` + `scripts/verify-agent-limits.mjs`) |
| typecheck | `pnpm -r typecheck` |
| api tests | `pnpm --filter @flash-sale/api exec jest --detectOpenHandles --forceExit`, failed if Jest reports any open handle |
| web tests | `pnpm --filter @flash-sale/web test` (Vitest) |

One `PASS`/`FAIL` line per check, then `VERIFY OK` (exit 0) or `VERIFY FAILED: <checks>` (exit 1). A failure prints the last 30 log lines and the log path. Quote the PASS/FAIL lines in your report.

## Launch

```bash
.claude/skills/verify/bin/launch.sh
```

1. Refuses if `.verify-run/` exists or a target port is already bound (by anything).
2. `docker compose up -d postgres redis`, waits until both are `healthy`.
3. Builds the API, starts `node apps/api/dist/main.js` with `PORT=$VERIFY_API_PORT` (default `3100`).
4. Starts Vite dev for the web on `127.0.0.1:$VERIFY_WEB_PORT` (default `5180`, `--strictPort`).
5. Ready means usable. The API answers `GET /api/v1/health` with 2xx, or, until the health endpoint exists, `GET /api/v1/__verify_ready__` with Nest's JSON 404. The web serves the page with `<div id="root">`.
6. Prints `READY run=<id> api=<url> web=<url> evidence=<dir>`.

Host port 3000 belongs to another local process on this machine, which is why verification never uses it. Each process runs in its own process group recorded in `.verify-run/{api,web}.pgid`, with logs in `.verify-run/*.log`.

Once a phase adds migrations or seed data (Phase 2 `SchemaConstraintsInitializer`, Phase 3 hydration), extend `launch.sh` so the API's readiness waits for them, and add that wait to this section.

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
```

`browser.sh` runs `google-chrome --headless=new` with a throwaway profile. `--dump-dom` captures the DOM after React renders, so a heading present there and absent from `index.html` proves client rendering. It cannot click or type. When a feature needs interaction (Phase 4 forms and buttons), add Playwright as a web devDependency, add an interaction helper here, and update the feature files.

## Evidence

Artifacts go to `.verify-evidence/<run-id>/<feature>/` (gitignored) and survive cleanup. Cleanup also copies the run's logs into `.verify-evidence/<run-id>/`.

Proof standards:
- Drive the real user path: public HTTP routes and the rendered page. Never call services directly or add test-only endpoints. `__verify_ready__` is only a readiness probe, never proof of a feature.
- Capture the action and the resulting state. For a mutation, add a second read-only view of the stored state: the user lookup endpoint, and for stock or orders a `psql` or `redis-cli` read via `docker compose exec`.
- Use mocks only where a production boundary already isolates the external system.
- Report each feature ID and entry point you drove. A path you could not reach is reported with the command and the unmet precondition, never as verified through a different path.

## Isolation

API and web instances isolate by port (`VERIFY_API_PORT`, `VERIFY_WEB_PORT`). Postgres and Redis do not isolate: there is one compose project (`flash-sale`) and one database. Two concurrent runs that reset the sale or purchase stock corrupt each other's results. Do not drive mutating features in parallel. Do not touch containers outside the `flash-sale` compose project.

## Cleanup

```bash
.claude/skills/verify/bin/cleanup.sh
```

Kills only the process groups recorded in `.verify-run/` and removes that directory. Keeps `.verify-evidence/`. It leaves postgres and redis running, because the gate and other work share them. Run cleanup after every run, failed iterations included.

## Rules

- Do not weaken a check or a journey to get green. A `verify-agent-limits` size violation is fixed by splitting, or by an `// agent-limits-allow <rule>: <reason>` marker when splitting would reduce clarity (AGENTS.md section 3).
- A Jest open-handle failure is fixed by closing the app, client, queue, or timer in `afterAll` or `OnModuleDestroy`. Never drop the flag.
- When a phase adds suites (integration, e2e, build) or user-facing features, extend `gate.sh` and `features/` in the same change.
