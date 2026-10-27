// ============================================================
// END-TO-END — the core BST Flow loop, against STAGING only.
//
//   customer fills the drop-off form
//   -> staff signs in, finds it on the board
//   -> tags it, prices one item
//   -> prepares the offer and sends it BY HAND (Open in Gmail + Mark Sent
//      Manually). The send-offer-email function is NEVER called.
//   -> customer opens the offer link and picks cash (Venmo) + donate leftovers
//   -> staff marks it paid
//   -> staff finds it again with search (Resolved column + spreadsheet)
//
// This cannot run from the Claude sandbox (*.supabase.co is blocked there).
// Run it from a laptop or CI against a Vercel PREVIEW deploy, whose config.js
// points at the staging database:
//
//   cd tests && npm ci
//   E2E_BASE_URL=https://<preview>.vercel.app \
//   E2E_PASSWORD='<staging test password>' \
//   E2E_SHOP_SLUG=<staging shop slug> \
//   npx playwright test --project=e2e
//
// Optional env:
//   E2E_STAFF_EMAIL        login used for the loop (default owner@example.test;
//                          try manager@example.test / staff@example.test too)
//   E2E_VERCEL_BYPASS      Vercel "Protection Bypass for Automation" secret, if
//                          the preview is behind Vercel Authentication
//   E2E_CLEANUP=1          soft-delete the test drop-off at the end
//
// SAFETY GUARDS (the test refuses / fails rather than touch real data):
//   - refuses to run against bstflow.com / www.bstflow.com
//   - aborts every request to the LIVE Supabase project
//   - fails if the dashboard booted with the LIVE project in its config
//   - aborts and fails on any call to the send-offer-email function
//   - Gmail compose is stubbed; nothing is ever emailed
//   - the test customer uses an @example.test address (undeliverable)
// ============================================================
const { test, expect } = require('@playwright/test');

const LIVE_REF = 'acmjbeatbwetjmkibfvm';
const STAGING_REF = 'qngqrvgcqunywyemzesy';

const BASE = process.env.E2E_BASE_URL || '';
const PASSWORD = process.env.E2E_PASSWORD || '';
const SHOP = process.env.E2E_SHOP_SLUG || '';
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL || 'owner@example.test';
const BYPASS = process.env.E2E_VERCEL_BYPASS || '';

const stamp = Date.now().toString(36);
const CUSTOMER = {
  name: `E2E Tester ${stamp}`,
  email: `e2e+${stamp}@example.test`,
  phone: '412-555-0199',
  bag: `E2E bag ${stamp}`,
  venmo: `@e2e-${stamp}`,
};

test.describe.configure({ mode: 'serial' });

test.skip(!BASE || !PASSWORD || !SHOP,
  'Set E2E_BASE_URL, E2E_PASSWORD and E2E_SHOP_SLUG to run the staging end-to-end test.');

test.beforeAll(() => {
  const host = new URL(BASE).hostname.toLowerCase();
  if (host === 'bstflow.com' || host === 'www.bstflow.com') {
    throw new Error('Refusing to run the end-to-end test against production (bstflow.com). Use a Vercel preview URL.');
  }
});

/** A browser context with every safety guard installed. */
async function guardedContext(browser) {
  const context = await browser.newContext({
    baseURL: BASE,
    permissions: ['clipboard-read', 'clipboard-write'],
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
  });
  const violations = [];
  await context.route(`https://${LIVE_REF}.supabase.co/**`, route => {
    violations.push('LIVE database request blocked: ' + route.request().url());
    return route.abort('blockedbyclient');
  });
  await context.route('**/functions/v1/send-offer-email**', route => {
    violations.push('send-offer-email call blocked: ' + route.request().url());
    return route.abort('blockedbyclient');
  });
  await context.route('https://mail.google.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Gmail (stubbed by test)</title>' }));
  return { context, violations };
}

async function expectStaging(page) {
  const url = await page.evaluate(() => (window.DANDELION_CONFIG || {}).SUPABASE_URL || '');
  expect(url, 'this page must be configured for the STAGING database').toContain(STAGING_REF);
}

async function signIn(page) {
  await page.goto('/dashboard.html');
  await expectStaging(page);
  await page.locator('#loginEmail').fill(STAFF_EMAIL);
  await page.locator('#loginPassword').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('#appView')).toBeVisible({ timeout: 20_000 });
  await expectStaging(page);
}

/** The kanban column (by visible name) that holds our test customer's card. */
function cardIn(page, columnName) {
  return page.locator('#kanban .col')
    .filter({ has: page.locator('.col-name', { hasText: columnName }) })
    .locator('.kcard', { hasText: CUSTOMER.name });
}

async function searchBoard(page) {
  await page.getByRole('button', { name: 'Refresh' }).first().click();
  await page.locator('#searchInput').fill(CUSTOMER.name);
}

let offerLink = '';

test('core loop: intake -> tag -> price -> offer (manual) -> customer picks cash -> paid -> search', async ({ browser }) => {
  // ── 1. Customer drop-off form ─────────────────────────────
  const cust = await guardedContext(browser);
  const form = await cust.context.newPage();
  await form.goto(`/intake.html?shop=${encodeURIComponent(SHOP)}`);
  await expectStaging(form);
  await form.getByRole('button', { name: /Get Started/ }).click();
  await form.locator('#step-2').getByRole('button', { name: /Continue/ }).click();
  await form.locator('#step-3').getByRole('button', { name: /Continue/ }).click();
  await form.locator('#consentPolicy').check();
  await form.locator('#consentSell').check();
  await form.locator('#step4Next').click();
  await form.locator('#name').fill(CUSTOMER.name);
  await form.locator('#email').fill(CUSTOMER.email);
  await form.locator('#phone').fill(CUSTOMER.phone);
  await form.locator('#step-5').getByRole('button', { name: /Continue/ }).click();
  await form.locator('#stdCard').click();
  await form.locator('#step6Next').click();
  await form.locator('#donateNoCard').click();          // "see my offer first"
  await form.locator('#step7Next').click();
  await form.locator('#bag').fill(CUSTOMER.bag);
  await form.locator('#submitBtn').click();
  await expect(form.locator('#successCard')).toBeVisible({ timeout: 15_000 });

  // ── 2. Staff signs in and finds it on the board ───────────
  const staff = await guardedContext(browser);
  const page = await staff.context.newPage();
  await signIn(page);
  await searchBoard(page);
  await expect(cardIn(page, 'New Drop-Offs')).toBeVisible({ timeout: 15_000 });
  await cardIn(page, 'New Drop-Offs').click();
  await expect(page.locator('#detailView')).toBeVisible();

  // ── 3. Tag ────────────────────────────────────────────────
  await page.getByRole('button', { name: /Start Tagging/ }).click();
  await page.getByRole('button', { name: /Finish Tagging/ }).click();
  await page.locator('#itemCountInput').fill('1');
  await page.getByRole('button', { name: /Continue to Pricing/ }).click();
  await expect(page.locator('#inBrand')).toBeVisible();

  // ── 4. Price one item (Custom Price tier, so it works with any staging matrix)
  await page.locator('#inBrand').fill('E2E Brand');
  await page.locator('#inType').fill('Tshirt');
  await page.locator('#inSize').fill('Kid');
  await page.keyboard.press('Escape');
  await page.locator('#inTier').selectOption('Custom Price');
  await page.locator('#inPrice').fill('10');
  await expect(page.locator('#addBtn')).toBeEnabled();
  await page.locator('#addBtn').click();
  await expect(page.locator('#linesBody')).toContainText('E2E Brand');

  // ── 5. Prepare the offer and send it BY HAND ──────────────
  await page.getByRole('button', { name: /Finish Pricing|Review & Send Offer/ }).click();
  await page.getByRole('button', { name: /Send Offer Email/ }).click();
  await expect(page.locator('#offerModal')).toHaveClass(/open/);
  await expect(page.locator('#offerTo')).toHaveValue(CUSTOMER.email);
  offerLink = (await page.locator('#offerLinkBox').textContent()).trim();
  expect(offerLink).toMatch(/offer\.html\?t=/);

  // "Open in Gmail": copies the email and opens a (stubbed) Gmail compose tab.
  const [gmail] = await Promise.all([
    staff.context.waitForEvent('page'),
    page.getByRole('button', { name: /Open in Gmail/ }).click(),
  ]);
  expect(gmail.url()).toContain('mail.google.com');
  expect(decodeURIComponent(gmail.url())).toContain(CUSTOMER.email);
  await gmail.close();

  // Never "Send Email Now" — only Mark Sent Manually.
  await page.locator('#offerMarkSentBtn').click();
  await expect(page.locator('#offerModal')).not.toHaveClass(/open/);
  await page.locator('.back-link', { hasText: 'Back to dashboard' }).click();
  await searchBoard(page);
  await expect(cardIn(page, 'Awaiting Reply')).toBeVisible({ timeout: 15_000 });

  // ── 6. Customer opens the offer and picks cash + donate ───
  const offer = await cust.context.newPage();
  const u = new URL(offerLink);
  await offer.goto(u.pathname + u.search);           // same preview host
  await expectStaging(offer);
  await expect(offer.locator('#formView')).toBeVisible({ timeout: 15_000 });
  await offer.locator('#optCash').click();
  await offer.locator('#venmo').fill(CUSTOMER.venmo);
  await offer.locator('#optDonate').click();
  await offer.locator('#submitBtn').click();
  await expect(offer.locator('#successView')).toBeVisible({ timeout: 15_000 });

  // ── 7. Staff sees the reply and marks it paid ─────────────
  await searchBoard(page);
  await expect(cardIn(page, 'Ready to Pay')).toBeVisible({ timeout: 15_000 });
  await cardIn(page, 'Ready to Pay').click();
  await expect(page.locator('.response-hero')).toContainText('Cash via Venmo');
  await expect(page.locator('.response-hero')).toContainText(CUSTOMER.venmo);
  await page.getByRole('button', { name: /Mark Paid/ }).click();
  await expect(page.locator('#toastMsg')).toContainText(/Paid/);

  // ── 8. Find it again with search ──────────────────────────
  await page.locator('.back-link', { hasText: 'Back to dashboard' }).click();
  await searchBoard(page);
  await expect(cardIn(page, 'Resolved')).toBeVisible({ timeout: 15_000 });
  await page.locator('#viewSheetBtn').click();
  await expect(page.locator('#sheetView')).toContainText(CUSTOMER.name);
  await page.locator('#viewKanbanBtn').click();

  // ── Optional cleanup (soft delete; recoverable) ───────────
  if (process.env.E2E_CLEANUP === '1') {
    await cardIn(page, 'Resolved').click();
    await page.getByRole('button', { name: /Delete Drop-Off/ }).first().click();
    await page.locator('#confirmDeleteBtn').click();
  }

  // ── Safety: nothing touched LIVE, nothing was emailed ─────
  expect(cust.violations, 'customer-side safety violations').toEqual([]);
  expect(staff.violations, 'staff-side safety violations').toEqual([]);
  await cust.context.close();
  await staff.context.close();
});
