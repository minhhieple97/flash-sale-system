# API HTTP surface

Status: implemented (Phase 1 prefix, Phase 2.1 error body).

API clients reach every application endpoint under the `/api/v1` prefix, and every error, an unknown route included, is a JSON body of exactly `{ code, message }`. Every later endpoint inherits this surface. `GET /health` is the one route outside the prefix.

## Sub-features

- `api-prefix` serves application routes under `/api/v1` only, except `/health`.
- `api-error-body` answers every error with exactly `{ code, message }`. An unknown route gets 404 `{ "code": "NOT_FOUND" }`. An unexpected server fault gets 500 `{ "code": "INTERNAL_ERROR", "message": "Internal server error" }` with no internal detail.

## How to get to it (user POV)

- Send any HTTP request to `http://127.0.0.1:3100/api/v1/<route>`.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Unknown route under the prefix.** Run `.claude/skills/verify/bin/http.sh api-http-surface unknown-route GET /api/v1/does-not-exist`. It prints `status=404` and a body of exactly `{"code":"NOT_FOUND","message":...}`. `unknown-route.headers.txt` has `content-type: application/json`.
- **Route outside the prefix.** Run `.claude/skills/verify/bin/http.sh api-http-surface no-prefix GET /flash-sales/current`. It prints `status=404` with `"code":"NOT_FOUND"`, while `GET /api/v1/flash-sales/current` answers 200 or the domain 404 `FLASH_SALE_NOT_FOUND` (see flash-sale-status.md).
- **Health outside the prefix.** `GET /health` answers (see health.md) and `.claude/skills/verify/bin/http.sh api-http-surface prefixed-health GET /api/v1/health` prints `status=404`.
- **Proof.** Keep the `*.request.txt`, `*.headers.txt` and `*.body.json` files from `.verify-evidence/<run-id>/api-http-surface/`.

## Gotchas

- The 500 path has no public trigger. `apps/api/test/unit/global-exception.filter.spec.ts` proves it in-process with a probe controller. Do not add a route to provoke it.
