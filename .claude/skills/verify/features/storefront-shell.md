# Storefront shell

Status: implemented (Phase 1, storefront composed in Phase 4.5).

A shopper opens the storefront in a browser and sees the app render, with a page heading reading "Flash Sale". Inside it sit the product card, the `Sale status` banner, the `Checkout` card, the `Order lookup` card and the `Demo scenarios` drawer.

## Sub-features

- `shell-load` serves the app at `/` and returns the HTML shell with `<div id="root">`.
- `shell-render` renders the React tree client-side, so the heading appears in the live DOM.
- `shell-compose` shows every module's card, with `/api` proxied to the API (Vite dev uses `VITE_API_PROXY_TARGET`, Docker uses nginx).

## How to get to it (user POV)

- Open `http://127.0.0.1:5180/` in a browser.

## Driving it with verify/bin

Preconditions:

- The baseline preconditions in README.md hold.

- **Load the shell.** Run `curl -s http://127.0.0.1:5180/ | grep -c 'id="root"'`. It prints `1`, and the raw HTML does not contain `Flash Sale</h1>`.
- **Render the app.** Run `.claude/skills/verify/bin/browser.sh storefront-shell home /`. The file `home.dom.html` contains a `<h1>` element whose text is `Flash Sale`, and `home.png` shows the heading on a light page.
- **Proof.** Keep `home.dom.html` and `home.png` from `.verify-evidence/<run-id>/storefront-shell/`, and report `grep -o '<h1[^>]*>[^<]*</h1>' home.dom.html`.

## Gotchas

- The heading text is also in `<title>`. Assert the `<h1>`, not just the string `Flash Sale`.
- Vite dev serves source modules. A broken import shows as an empty `<div id="root"></div>` in the DOM dump, not as an HTTP error.
- `browser.sh` cannot click. Interactive journeys use `ui.sh` (SKILL.md).
- `browser.sh` dumps the DOM before the first API responses land, so the cards may still show their loading placeholders there. Assert card content with `ui.sh`, which waits.
