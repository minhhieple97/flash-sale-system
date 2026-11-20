# API HTTP surface

Status: implemented (Phase 1).

API clients reach every endpoint under the `/api/v1` prefix, and an unknown route returns a JSON error body rather than HTML. Every later endpoint inherits this surface.

## Sub-features

- `api-prefix` serves application routes under `/api/v1` only.
- `api-json-404` answers unknown routes with status 404 and a JSON body containing `"statusCode":404`.

## How to get to it (user POV)

- Send any HTTP request to `http://127.0.0.1:3100/api/v1/<route>`.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Unknown route under the prefix.** Run `.claude/skills/verify/bin/http.sh api-http-surface unknown-route GET /api/v1/does-not-exist`. It prints `status=404` and a body with `"statusCode":404` and `"error":"Not Found"`. `unknown-route.headers.txt` has `content-type: application/json`.
- **Route outside the prefix.** Once Phase 2 ships a real route (e.g. `GET /api/v1/products/featured`), run the same route without the prefix: `.claude/skills/verify/bin/http.sh api-http-surface no-prefix GET /products/featured`. It prints `status=404`, while the prefixed route answers 200.
- **Proof.** Keep the `*.request.txt`, `*.headers.txt` and `*.body.json` files from `.verify-evidence/<run-id>/api-http-surface/`.

## Gotchas

- Until Phase 2 adds a real route, the prefix cannot be proven from outside, because every path is a 404. `apps/api/test/unit/app.smoke.spec.ts` proves it in-process with a probe controller.
- Phase 2's `GlobalExceptionFilter` will change the error body to `{ code, message }`. Update `api-json-404` then.
