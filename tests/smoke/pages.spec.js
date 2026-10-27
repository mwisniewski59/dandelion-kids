// ============================================================
// SMOKE TEST — every page loads without console errors.
//
// Runs fully offline: the repo is served by python -m http.server and every
// request to *.supabase.co, jsDelivr and Google Fonts is answered by
// support/mock-supabase.js with fake data. No real database, no email.
// ============================================================
const { test, expect } = require('@playwright/test');
const { installMocks, signInFake, LIVE_REF, STAGING_REF } = require('../support/mock-supabase');

// Console noise that is not an app bug.
const IGNORE = [
  /favicon\.ico/i,
  /Download the React DevTools/i,
];

async function openPage(browser, url, { signedIn = false } = {}) {
  const context = await browser.newContext();
  const log = await installMocks(context);
  if (signedIn) await signInFake(context);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error' && !IGNORE.some(re => re.test(m.text()))) errors.push('console: ' + m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!IGNORE.some(re => re.test(u))) errors.push('requestfailed: ' + u + ' ' + (r.failure()?.errorText || ''));
  });
  // Block popups (e.g. Gmail) from leaving the sandbox.
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800); // let async boot (session, RPCs) settle
  return { context, page, errors, log };
}

const PAGES = [
  { name: 'landing',            url: '/index.html',                 check: p => expect(p.locator('body')).toBeVisible() },
  { name: 'signup',             url: '/signup.html',                check: p => expect(p.locator('body')).toBeVisible() },
  { name: 'training',           url: '/training.html',              check: p => expect(p.locator('.slide.active').first()).toBeVisible() },
  { name: 'intake (no shop)',   url: '/intake.html',                check: p => expect(p.getByRole('button', { name: /Get Started/ })).toBeVisible() },  // defaults to dandelion-kids
  { name: 'intake',             url: '/intake.html?shop=test-shop', check: p => expect(p.getByRole('button', { name: /Get Started/ })).toBeVisible() },
  { name: 'offer (no token)',   url: '/offer.html',                 check: p => expect(p.getByText(/can't find that offer/i)).toBeVisible() },
  { name: 'offer',              url: '/offer.html?t=smoke-token',   check: p => expect(p.getByText('Cash via Venmo')).toBeVisible() },
  { name: 'dashboard (login)',  url: '/dashboard.html',             check: p => expect(p.locator('#loginEmail')).toBeVisible() },
  { name: 'dashboard (signed in)', url: '/dashboard.html', signedIn: true,
    check: async p => {
      await expect(p.locator('#appView')).toBeVisible();
      await expect(p.locator('#kanban .kcard').first()).toBeVisible();
    } },
];

for (const pg of PAGES) {
  test(`${pg.name} loads with no console errors`, async ({ browser }) => {
    const { context, page, errors, log } = await openPage(browser, pg.url, { signedIn: !!pg.signedIn });
    await pg.check(page);
    // intake.html deliberately throws 'shop not resolved' to stop booting when
    // the ?shop= parameter is missing; that one is expected.
    const real = errors.filter(e => !(pg.allowShopError && /shop not resolved/.test(e)));
    expect(real, 'console/page errors').toEqual([]);
    expect(log.functionCalls, 'edge functions must never be called').toEqual([]);
    await context.close();
  });
}

// Signed-in dashboard: click through every tab and open a drop-off.
test('dashboard tabs and drop-off detail render without errors', async ({ browser }) => {
  const { context, page, errors, log } = await openPage(browser, '/dashboard.html', { signedIn: true });
  for (const tab of ['Insights', 'Customers', 'Pricing', 'Rules', 'Settings', 'Drop-Offs']) {
    await page.locator('.nav-btn', { hasText: tab }).click();
    await page.waitForTimeout(300);
  }
  await page.locator('#viewSheetBtn').click();
  await page.waitForTimeout(300);
  await page.locator('#viewKanbanBtn').click();
  await page.locator('#kanban .kcard').first().click();
  await expect(page.locator('#detailView')).toBeVisible();
  expect(errors, 'console/page errors').toEqual([]);
  expect(log.functionCalls).toEqual([]);
  await context.close();
});

// Off-production hosts (localhost, *.vercel.app previews) must only ever talk
// to the STAGING database. Checks both the config each page booted with and
// the Supabase project it actually contacted.
test('off-production pages use the STAGING database only', async ({ browser }) => {
  const offenders = [];
  for (const url of ['/intake.html?shop=test-shop', '/offer.html?t=smoke-token', '/dashboard.html', '/signup.html']) {
    const { context, page, log } = await openPage(browser, url, { signedIn: url.startsWith('/dashboard') });
    const cfgUrl = await page.evaluate(() => (window.DANDELION_CONFIG || {}).SUPABASE_URL || '');
    if (cfgUrl.includes(LIVE_REF)) offenders.push(`${url}: window.DANDELION_CONFIG points at LIVE`);
    if (log.refs.has(LIVE_REF)) offenders.push(`${url}: sent requests to LIVE (${LIVE_REF})`);
    await context.close();
  }
  expect(offenders, `pages that would use the LIVE project instead of staging ${STAGING_REF}`).toEqual([]);
});

// The dashboard's "Copy Intake Link" must produce a link that actually opens
// the shop's form (intake.html refuses to load without ?shop=<slug>).
test('Copy Intake Link includes the shop', async ({ browser }) => {
  const { context, page } = await openPage(browser, '/dashboard.html', { signedIn: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#fabBtn').click();
  await page.getByRole('button', { name: 'Copy Intake Link' }).click();
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/intake\.html\?shop=test-shop$/);
  await context.close();
});
