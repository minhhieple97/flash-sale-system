# Containerized stack

Status: implemented (Phase 6.1 to 6.2). The web container serves the Phase 4 storefront.

An operator builds and starts the whole system with one Compose command. PostgreSQL, Redis, the API image, and the nginx web image come up in dependency order. The API answers `/health` on its published port, and the web container serves the built storefront and proxies `/api/` and `/health` to the API over the Compose network.

## Sub-features

- `stack-build` builds the API and web images with pnpm 12 and `--frozen-lockfile`. The pnpm store survives between builds in a BuildKit cache mount.
- `stack-up` starts all four services. The API's healthcheck gates the web and k6 services.
- `api-published` serves `GET /health` on host port `PORT` (default 3000).
- `web-served` serves the web build on host port `WEB_PORT` (default 8080).
- `web-proxy` forwards `/api/*` and `/health` from nginx to `api:3000`.

## How to get to it (user POV)

- Run `docker compose up -d --build --wait` from the repo root.
- Open `http://localhost:3000/health` and `http://localhost:8080/`.

## Driving it with verify/bin

Preconditions:

- Host port 3000 is held by another local process on this machine, so publish the API on 3001: prefix every `docker compose up` with `PORT=3001`.
- No `.verify-run/` instance needs to exist. This feature drives the containers, not `launch.sh`.

- **Build and start.** Run `PORT=3001 docker compose up -d --build --wait`. It exits 0 once postgres, redis and api report healthy. `docker compose ps` shows `api ... (healthy) 0.0.0.0:3001->3000/tcp` and `web ... 0.0.0.0:8080->80/tcp`.
- **Store cache.** In `docker compose build --progress=plain api`, after any change that reruns the install step, the install log line reads `reused 475, downloaded 0` and the deploy line reads `reused 205, downloaded 0`.
- **API health.** `curl -s -i localhost:3001/health` returns `200` with `{"status":"ok","checks":{"database":"up","redis":"up"}}`.
- **Web and proxy.** `curl -s localhost:8080/ | grep -c 'id="root"'` prints `1`. `curl -s -i localhost:8080/api/v1/flash-sales/current` returns `200` with the sale JSON, and `curl -s -i localhost:8080/health` returns the API's health body.
- **Rendered page.** `.claude/skills/verify/bin/browser.sh docker-stack web-8080 http://localhost:8080/` writes a DOM with `<h1 ...>Flash Sale</h1>` and a screenshot.
- **Storefront through nginx.** This step resets the sale. Run `VERIFY_WEB_PORT=8080 .claude/skills/verify/bin/ui.sh docker-stack storefront-8080 '<steps>'` with the steps `goto /`, expect `TITAN-X1-LE`, click `Demo scenarios` then `High Scarcity`, expect `3 of 3 left` in `Sale status`, fill `User ID` in `Checkout` with `docker-alice@example.com`, click `Buy Now`, expect `Verified receipt` in `Checkout`, fill `User ID` in `Order lookup` with `DOCKER-alice@example.com`, click `Check order`, expect `Verified receipt` in `Order lookup`, then click `Active Sale` and expect `100 of 100 left`. Every step logs `PASS` with no `HTTP` or `PAGEERROR` line (23 steps on 2026-11-21). The production build has no favicon 404, because nginx answers `/favicon.ico` with `index.html`.
- **Proof.** Save `docker compose ps`, the curl responses, the DOM and the screenshot under `.verify-evidence/<run-id>/docker-stack/`. Without a `launch.sh` run, `browser.sh` writes to an `adhoc-<time>` directory, so move its files next to the rest.

## Gotchas

- `docker compose up` with a different `PORT` than the running stack recreates the API container on the new port. The k6 scripts run with `--no-deps` for that reason.
- Stop the API container (`docker compose stop api web`) before `pnpm verify` or any jest integration run. The container's BullMQ worker shares the queue name and would take the suites' jobs.
- `docker compose build --no-cache` bypasses the store cache mount for the install step, so expect downloads there. Plain rebuilds reuse it.
- The web service has no healthcheck of its own. `--wait` treats it as ready once it runs.
