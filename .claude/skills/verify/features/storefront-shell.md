# Storefront shell

Status: implemented (Phase 1).

A shopper opens the storefront in a browser and sees the app render, with a page heading reading "Flash Sale". Later phases add the product card, sale banner, checkout form, order lookup and scenario drawer inside this shell.

## Sub-features

- `shell-load` serves the app at `/` and returns the HTML shell with `<div id="root">`.
- `shell-render` renders the React tree client-side, so the heading appears in the live DOM.

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
- `browser.sh` cannot click. Interactive journeys need the Playwright helper described in SKILL.md.
