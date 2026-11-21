import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [dir, webUrl, name, stepsJson] = process.argv.slice(2);
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
const { chromium } = require('playwright-core');

const CHROME = process.env.VERIFY_CHROME ?? '/usr/bin/google-chrome';
const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
const lines = [];

function record(line) {
  const entry = `${new Date().toISOString()} ${line}`;
  lines.push(entry);
  process.stdout.write(`${entry}\n`);
}

async function capture(page, label) {
  fs.writeFileSync(path.join(dir, `${label}.dom.html`), await page.content());
  await page.screenshot({ path: path.join(dir, `${label}.png`), fullPage: true });
  record(`captured ${label}.dom.html ${label}.png`);
}

function scope(page, arg) {
  return arg.in ? page.getByRole('region', { name: arg.in, exact: true }) : page;
}

function byRole(page, arg) {
  return scope(page, arg).getByRole(arg.role ?? 'button', { name: arg.name, exact: true });
}

async function waitUntil(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

const ACTIONS = {
  clockSkewMs: (page, arg) => page.clock.setSystemTime(Date.now() + arg),
  goto: (page, arg) => page.goto(new URL(arg, webUrl).href),
  click: (page, arg) => byRole(page, arg).click(),
  fill: (page, arg) => scope(page, arg).getByLabel(arg.label, { exact: true }).fill(arg.value),
  expect: (page, arg) =>
    scope(page, arg)
      .getByText(arg.text, { exact: arg.exact ?? false })
      .first()
      .waitFor({ state: 'visible', timeout: arg.timeoutMs ?? DEFAULT_TIMEOUT_MS }),
  disabled: (page, arg) =>
    waitUntil(
      async () => (await byRole(page, arg).isDisabled()) === (arg.value ?? true),
      arg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      `${arg.name} disabled=${arg.value ?? true}`,
    ),
  snap: (page, arg) => capture(page, arg),
  scrollSnap: async (page, arg) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: path.join(dir, `${arg}.png`) });
    record(`captured ${arg}.png (viewport, scrolled to bottom)`);
  },
};

async function run() {
  const steps = JSON.parse(stepsJson);
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => record(`PAGEERROR ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') record(`CONSOLE-ERROR ${msg.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) record(`HTTP ${response.status()} ${response.url()}`);
  });
  let failed = false;
  for (const step of steps) {
    const [kind] = Object.keys(step);
    const action = ACTIONS[kind];
    try {
      if (!action) throw new Error(`unknown step "${kind}"`);
      await action(page, step[kind]);
      record(`PASS ${JSON.stringify(step)}`);
    } catch (error) {
      record(`FAIL ${JSON.stringify(step)} ${error.message.split('\n')[0]}`);
      await capture(page, `${name}.failure`);
      failed = true;
      break;
    }
  }
  if (!failed) await capture(page, name);
  await browser.close();
  fs.writeFileSync(path.join(dir, `${name}.steps.log`), `${lines.join('\n')}\n`);
  return failed ? 1 : 0;
}

process.exitCode = await run();
