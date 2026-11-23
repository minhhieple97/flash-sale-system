import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright-core';

const WEB_URL = (process.env.WEB_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY?.trim() ?? '';
const WAIT_TIMEOUT_MS = 15_000;
const ACTIVE_SALE_RESET = { totalStock: 100, startsOffsetSeconds: 0, durationSeconds: 3600 };
const SMOKE_SALE_RESET = { totalStock: 2, startsOffsetSeconds: 0, durationSeconds: 3600 };
const SYSTEM_CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function resolveChromePath() {
  const explicit = process.env.CHROME_PATH?.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`CHROME_PATH does not exist: ${explicit}`);
    }
    return explicit;
  }
  const systemChrome = SYSTEM_CHROME_PATHS.find((candidate) => existsSync(candidate));
  if (systemChrome) return systemChrome;
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return bundled;
  throw new Error('No Chromium executable found; set CHROME_PATH or install google-chrome.');
}

async function resetSale(payload) {
  const headers = { 'content-type': 'application/json' };
  if (ADMIN_API_KEY) headers['x-admin-key'] = ADMIN_API_KEY;
  const response = await fetch(`${WEB_URL}/api/v1/admin/flash-sales/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(
    response.status,
    200,
    `Expected 200 resetting sale at ${WEB_URL}, got ${response.status}: ${await response.text()}`,
  );
}

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT_MS });
}

async function submitCheckout(checkout, userId) {
  await checkout.getByLabel('User ID (username or email)').fill(userId);
  await checkout.getByRole('button', { name: 'Buy Now' }).click();
}

async function lookupOrder(lookup, userId) {
  await lookup.getByLabel('User ID (username or email)').fill(userId);
  await lookup.getByRole('button', { name: 'Check order' }).click();
}

async function applyActiveSaleViaDrawer(page) {
  await page.getByRole('button', { name: 'Demo scenarios' }).click();
  const activeSaleButton = page.getByRole('button', { name: 'Active Sale' });
  await activeSaleButton.click();
  if (ADMIN_API_KEY) {
    const adminKeyInput = page.getByLabel('Admin key');
    await expectVisible(adminKeyInput);
    await adminKeyInput.fill(ADMIN_API_KEY);
    await activeSaleButton.click();
  }
}

describe('Flash Sale storefront full-stack browser E2E', () => {
  let browser;
  let page;
  let saleStatus;
  let checkout;
  let lookup;
  const pageErrors = [];

  before(async () => {
    await resetSale(SMOKE_SALE_RESET);
    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: ['--no-sandbox'],
    });
    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${WEB_URL}/`, { waitUntil: 'domcontentloaded' });
    saleStatus = page.getByRole('region', { name: 'Sale status' });
    checkout = page.getByRole('region', { name: 'Checkout' });
    lookup = page.getByRole('region', { name: 'Order lookup' });
  });

  after(async () => {
    try {
      await browser?.close();
    } finally {
      await resetSale(ACTIVE_SALE_RESET);
    }
  });

  test('renders featured product and live 2-stock sale status', async () => {
    await expectVisible(
      page.getByRole('heading', { name: 'Titan X1 Carbon Wireless Mechanical Keyboard' }),
    );
    await expectVisible(saleStatus.getByText('Live now', { exact: true }));
    await expectVisible(saleStatus.getByText('2 of 2 left', { exact: true }));
  });

  test('confirms email purchase and decrements stock to 1 of 2 left', async () => {
    await submitCheckout(checkout, 'smoke-alice@example.com');
    await expectVisible(checkout.getByText('Order confirmed', { exact: true }));
    await expectVisible(checkout.getByText('Verified receipt', { exact: true }));
    await expectVisible(saleStatus.getByText('1 of 2 left', { exact: true }));
  });

  test('rejects duplicate normalized email with Already purchased without consuming stock', async () => {
    await submitCheckout(checkout, '  SMOKE-ALICE@Example.com ');
    await expectVisible(checkout.getByText('Already purchased', { exact: true }));
    await expectVisible(saleStatus.getByText('1 of 2 left', { exact: true }));
  });

  test('sells out on second buyer username and disables Buy Now', async () => {
    await submitCheckout(checkout, 'smoke-bob');
    await expectVisible(checkout.getByText('Order confirmed', { exact: true }));
    await expectVisible(checkout.getByText('Verified receipt', { exact: true }));
    await expectVisible(saleStatus.getByText('0 of 2 left', { exact: true }));
    await expectVisible(saleStatus.getByText('Sold out', { exact: true }));
    await expectVisible(checkout.getByText('This sale is sold out.', { exact: true }));
    assert.equal(await checkout.getByRole('button', { name: 'Buy Now' }).isDisabled(), true);
  });

  test('shows confirmed receipt and not-found status in Order lookup', async () => {
    await lookupOrder(lookup, 'smoke-alice@example.com');
    await expectVisible(lookup.getByText('Order confirmed', { exact: true }));
    await expectVisible(lookup.getByText('Verified receipt', { exact: true }));
    await lookupOrder(lookup, 'smoke-nobody');
    await expectVisible(lookup.getByText('No order found for smoke-nobody', { exact: true }));
  });

  test('resets back to Active Sale via Demo scenarios drawer with zero page errors', async () => {
    await applyActiveSaleViaDrawer(page);
    await expectVisible(saleStatus.getByText('100 of 100 left', { exact: true }));
    await expectVisible(saleStatus.getByText('Live now', { exact: true }));
    assert.deepEqual(pageErrors, []);
  });
});
