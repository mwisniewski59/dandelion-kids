// ============================================================
// SMOKE TEST — buyer / pricer / associate / manager roles.
//
// Fully offline (support/mock-supabase.js, fake data only). Checks that each
// role sees the select (Tagging) and price (Pricing) actions enabled or
// disabled per the matrix in docs/roles-plan.md, that the handlers refuse
// even if called directly, and that the database trigger's BSTFLOW_ROLE_*
// errors become the friendly toasts.
// ============================================================
const { test, expect } = require('@playwright/test');
const { installMocks, signInFake } = require('../support/mock-supabase');

// Fixture ids (index in support/mock-supabase.js DROPOFFS).
const id = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const BAG = { intake: id(0), tagging: id(1), pricing: id(2), priced: id(7), bulk: id(8) };

const SELECT_MSG = 'Only a buyer, manager or owner can select clothes.';
const PRICE_MSG = 'Only a buyer, pricer, manager or owner can price clothes.';

const IGNORE = [/favicon\.ico/i];

async function openAs(browser, role, mockOpts = {}) {
  const context = await browser.newContext();
  const log = await installMocks(context, { role, ...mockOpts });
  await signInFake(context);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => {
    // A refused save is logged on purpose ("Save failed: ...") and the 403 shows
    // up as a failed resource load; neither is an app bug.
    if (m.type() === 'error' && !IGNORE.some(re => re.test(m.text()))
        && !/^Save failed:|status of 403/.test(m.text())) errors.push('console: ' + m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); });
  await page.goto('/dashboard.html', { waitUntil: 'load' });
  await expect(page.locator('#appView')).toBeVisible();
  await expect(page.locator('#kanban .kcard').first()).toBeVisible();
  return { context, page, log, errors };
}

async function openBag(page, bagId) {
  await page.evaluate(i => openDropoff(i), bagId);
  await expect(page.locator('#detailView')).toBeVisible();
}

const dropoffWrites = log => log.writes.filter(w => w.table === 'dropoffs');

// Expected matrix per role (as the dashboard should resolve it).
const CASES = [
  { role: 'buyer',     label: 'Buyer',     select: true,  price: true  },
  { role: 'pricer',    label: 'Pricer',    select: false, price: true  },
  { role: 'associate', label: 'Associate', select: false, price: false },
  { role: 'manager',   label: 'Manager',   select: true,  price: true  },
  // Legacy and unknown roles.
  { role: 'staff',     label: 'Buyer',     select: true,  price: true  },
  { role: 'janitor',   label: 'Associate', select: false, price: false },
];

for (const c of CASES) {
  test(`role ${c.role}: select ${c.select ? 'on' : 'off'}, price ${c.price ? 'on' : 'off'}`, async ({ browser }) => {
    const { context, page, log, errors } = await openAs(browser, c.role);

    // Sidebar shows the role next to the email.
    await expect(page.locator('#navRole')).toHaveText(c.label);

    // Walk-In (FAB) needs select.
    await page.locator('#fabBtn').click();
    const wi = page.locator('#fabWalkIn');
    await expect(wi).toBeVisible();
    if (c.select) await expect(wi).toBeEnabled(); else await expect(wi).toBeDisabled();
    await page.locator('#fabBtn').click();

    // Start Tagging (intake).
    await openBag(page, BAG.intake);
    const start = page.locator('#ctaStartTagging');
    await expect(start).toBeVisible();
    if (c.select) await expect(start).toBeEnabled();
    else {
      await expect(start).toBeDisabled();
      await expect(page.locator('#detailBody .role-reason', { hasText: SELECT_MSG })).toBeVisible();
    }

    // Finish Tagging (tagging).
    await openBag(page, BAG.tagging);
    const finishTag = page.locator('#ctaFinishTagging');
    await expect(finishTag).toBeVisible();
    if (c.select) await expect(finishTag).toBeEnabled(); else await expect(finishTag).toBeDisabled();

    // Standard pricing tool + Finish Pricing (pricing, not yet priced).
    await openBag(page, BAG.pricing);
    const finishPrice = page.locator('#ctaFinishPricing');
    await expect(finishPrice).toBeVisible();
    const fieldset = page.locator('#pricingFieldset');
    await expect(page.locator('#inBrand')).toBeVisible();          // the tool is shown either way
    const removeBtn = page.locator('#linesBody button').first();
    if (c.price) {
      await expect(finishPrice).toBeEnabled();
      await expect(fieldset).not.toHaveAttribute('disabled', /.*/);
      await expect(page.locator('#inBrand')).toBeEnabled();
      await expect(removeBtn).toBeEnabled();
    } else {
      await expect(finishPrice).toBeDisabled();
      await expect(fieldset).toHaveAttribute('disabled', /.*/);
      await expect(page.locator('#inBrand')).toBeDisabled();
      await expect(removeBtn).toBeDisabled();
      await expect(page.locator('#detailBody .role-reason', { hasText: PRICE_MSG }).first()).toBeVisible();
    }

    // Already-priced bag: anyone may review and send the offer.
    await openBag(page, BAG.priced);
    await expect(page.locator('#ctaFinishPricing')).toBeEnabled();
    await expect(page.locator('#ctaFinishPricing')).toHaveText(/Review & Send Offer/);

    // Bulk counts are pricing.
    await openBag(page, BAG.bulk);
    if (c.price) {
      await expect(page.locator('#bulkSaveBtn')).toBeEnabled();
      await expect(page.locator('#bulkItems')).toBeEnabled();
    } else {
      await expect(page.locator('#bulkSaveBtn')).toBeDisabled();
      await expect(page.locator('#bulkItems')).toBeDisabled();
    }

    expect(errors, 'console/page errors').toEqual([]);
    expect(log.functionCalls).toEqual([]);
    await context.close();
  });
}

// Handlers refuse even if a disabled button is bypassed (defense in depth).
test('associate: handlers refuse select/price/walk-in without writing', async ({ browser }) => {
  const { context, page, log, errors } = await openAs(browser, 'associate');

  await openBag(page, BAG.intake);
  await page.evaluate(() => advance('tagging'));
  await expect(page.locator('#toastMsg')).toHaveText(SELECT_MSG);

  await openBag(page, BAG.tagging);
  await page.evaluate(() => submitItemCount());
  await expect(page.locator('#toastMsg')).toHaveText(SELECT_MSG);

  await openBag(page, BAG.pricing);
  await page.evaluate(() => removeLine(0));
  await expect(page.locator('#toastMsg')).toHaveText(PRICE_MSG);
  await page.evaluate(() => finishPricing());
  await expect(page.locator('#toastMsg')).toHaveText(PRICE_MSG);

  await openBag(page, BAG.bulk);
  await page.evaluate(() => saveBulkAndAdvance());
  await expect(page.locator('#toastMsg')).toHaveText(PRICE_MSG);

  await page.evaluate(() => openWalkInModal());
  await expect(page.locator('#walkInModal')).not.toHaveClass(/open/);
  await page.evaluate(() => submitWalkIn());
  await expect(page.locator('#toastMsg')).toHaveText(SELECT_MSG);

  expect(dropoffWrites(log), 'no drop-off writes').toEqual([]);
  expect(log.writes.filter(w => w.table === 'customers'), 'no customer writes').toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

// Associates can still send an offer that was already priced: it opens the
// review without re-writing amounts.
test('associate: Review & Send Offer opens review without writing amounts', async ({ browser }) => {
  const { context, page, log, errors } = await openAs(browser, 'associate');
  await openBag(page, BAG.priced);
  await page.locator('#ctaFinishPricing').click();
  await expect(page.locator('#reviewOverlay')).toHaveClass(/open/);
  // Line remove buttons on the review are pricing too.
  await expect(page.locator('#reviewContainer .line-table button').first()).toBeDisabled();
  expect(dropoffWrites(log)).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

// Pricer pricing a bulk bag must not write item_count (select-guarded).
test('pricer: bulk save writes pricing fields but not item_count', async ({ browser }) => {
  const { context, page, log, errors } = await openAs(browser, 'pricer');
  await openBag(page, BAG.bulk);
  await page.locator('#bulkItems').fill('10');
  await page.locator('#bulkSaveBtn').click();
  await expect(page.locator('#toastMsg')).toHaveText(/Bulk priced/);
  const patch = dropoffWrites(log).find(w => w.method === 'PATCH');
  expect(patch, 'a PATCH to dropoffs').toBeTruthy();
  expect(patch.body).toHaveProperty('pricing_lines');
  expect(patch.body).toHaveProperty('venmo_amount');
  expect(patch.body).not.toHaveProperty('item_count');
  expect(errors).toEqual([]);
  await context.close();
});

// The DB trigger's errors become the friendly toasts.
for (const [marker, msg] of [['BSTFLOW_ROLE_SELECT', SELECT_MSG], ['BSTFLOW_ROLE_PRICE', PRICE_MSG]]) {
  test(`${marker} from the database shows the friendly toast`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'buyer', {
      dropoffWriteError: { code: '42501', message: marker, details: null, hint: null },
    });
    if (marker === 'BSTFLOW_ROLE_SELECT') {
      await openBag(page, BAG.intake);
      await page.locator('#ctaStartTagging').click();
    } else {
      await openBag(page, BAG.bulk);
      await page.locator('#bulkSaveBtn').click();
    }
    await expect(page.locator('#toastMsg')).toHaveText(msg);
    await context.close();
  });
}
