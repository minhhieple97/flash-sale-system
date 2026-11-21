# Storefront shell

Status: implemented (Phase 1, storefront composed in Phase 4.5).

A shopper opens the storefront in a browser and sees the app render, with a page heading reading "Flash Sale". Inside it sit the product card, the `Sale status` banner, the `Checkout` card, the `Order lookup` card and the `Demo scenarios` drawer.

## Sub-features

- `shell-load` serves the app at `/` and returns the HTML shell with `<div id="root">`.
- `shell-render` renders the React tree client-side, so the heading appears in the live DOM.
- `shell-compose` shows every module's card, with `/api` proxied to the API (Vite dev uses `VITE_API_PROXY_TARGET`, Docker uses nginx).
- `shell-api-down` shows the error states when the API cannot be reached. A `Sale status` card that already has data adds `Reconnecting...` when a later poll fails. A first load that fails shows `Could not load the product` and `Could not load the sale status`. Through Vite dev the dead proxy answers 502 with no `{ code, message }` body, so each alert carries the generic `Something went wrong. Please try again.`

## How to get to it (user POV)

- Open `http://127.0.0.1:5180/` in a browser.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Load the shell.** Run `curl -s http://127.0.0.1:5180/ | grep -c 'id="root"'`. It prints `1`, and the raw HTML does not contain `Flash Sale</h1>`.
- **Render the app.** Run `.claude/skills/verify/bin/browser.sh storefront-shell home /`. The file `home.dom.html` contains a `<h1>` element whose text is `Flash Sale`, and `home.png` shows the heading on a light page.
- **API down.** This step kills the API, so run it last. Start `.claude/skills/verify/bin/ui.sh storefront-shell api-down-reconnecting '[{"goto":"/"},{"expect":{"text":"Live now","exact":true,"in":"Sale status"}},{"expect":{"text":"Reconnecting...","in":"Sale status","timeoutMs":20000}}]' &`, wait 6 s, then run `kill -TERM -- "-$(cat .verify-run/api.pgid)"` and `wait`. Every step logs `PASS`, with `HTTP 502 .../api/v1/flash-sales/current` in the log. Then run `.claude/skills/verify/bin/ui.sh storefront-shell api-down-load '[{"goto":"/"},{"expect":{"text":"Could not load the product"}},{"expect":{"text":"Could not load the sale status","in":"Sale status"}}]'`. `doctor.sh` now reports the API as `BAD`, as it should. Run `cleanup.sh` and `launch.sh` before driving anything else.
- **Proof.** Keep `home.dom.html` and `home.png` from `.verify-evidence/<run-id>/storefront-shell/`, and report `grep -o '<h1[^>]*>[^<]*</h1>' home.dom.html`. For the API-down step keep both `api-down-*` step logs and screenshots.

## Gotchas

- The heading text is also in `<title>`. Assert the `<h1>`, not just the string `Flash Sale`.
- Vite dev serves source modules. A broken import shows as an empty `<div id="root"></div>` in the DOM dump, not as an HTTP error.
- `AppErrorBoundary` (`apps/web/src/app/AppErrorBoundary.tsx`, text `Something went wrong` with a `Reload page` button) has no public trigger. `apps/web/src/app/__tests__/AppErrorBoundary.spec.tsx` covers it. Do not add a throwing component to provoke it.
- `browser.sh` cannot click. Interactive journeys use `ui.sh` (SKILL.md).
- `browser.sh` dumps the DOM before the first API responses land, so the cards may still show their loading placeholders there. Assert card content with `ui.sh`, which waits.
