# Health

Status: implemented (Phase 2.5).

An operator or orchestrator asks whether the API can serve traffic. The answer is 200 when PostgreSQL answers `SELECT 1` and Redis answers `PING`, and 503 with the failing dependency named otherwise.

## Sub-features

- `health-up` returns 200 `{ "status": "ok", "checks": { "database": "up", "redis": "up" } }`.
- `health-down` returns 503 `{ "status": "error", "checks": { ... "down" ... } }` when a dependency fails or does not answer within 1 s.

## How to get to it (user POV)

- `GET http://127.0.0.1:3100/health` (no `/api/v1` prefix).

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Up.** Run `.claude/skills/verify/bin/http.sh health up GET /health`. It prints `status=200` and the `ok` body.
- **Redis down.** Run `docker compose stop redis`, then `.claude/skills/verify/bin/http.sh health redis-down GET /health`. It prints `status=503` with `"redis":"down"` and `"database":"up"` within about 1 s. Run `docker compose start redis`, wait until `docker compose ps redis` shows `healthy`, then read `/health` again as `redis-recovered` and expect 200.
- **Proof.** Keep the `*.body.json` files from `.verify-evidence/<run-id>/health/`.

## Gotchas

- Stopping redis affects every other run sharing the compose project. Do it only when no other verification run is active, and always start it again.
- `launch.sh` treats a 2xx from this route as API readiness, so a launch with a dependency down never reaches `READY`.
