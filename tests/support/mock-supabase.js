// ============================================================
// Offline mocks for the local smoke test.
//
// The sandbox (and CI) can't reach *.supabase.co or the jsDelivr / Google
// Fonts CDNs, so the smoke test answers every one of those requests itself:
//   - cdn.jsdelivr.net  -> local copies installed in tests/node_modules
//   - fonts.googleapis/gstatic -> empty stylesheet / font
//   - *.supabase.co     -> tiny fake REST / RPC / auth responses (fake data)
// Nothing here talks to a real database.
// ============================================================
const path = require('path');
const fs = require('fs');

const LIVE_REF = 'acmjbeatbwetjmkibfvm';
const STAGING_REF = 'qngqrvgcqunywyemzesy';

const NM = path.join(__dirname, '..', 'node_modules');
const CDN_FILES = [
  [/@supabase\/supabase-js@2/, path.join(NM, '@supabase/supabase-js/dist/umd/supabase.js')],
  [/xlsx@[\d.]+\/dist\/xlsx\.full\.min\.js/, path.join(NM, 'xlsx/dist/xlsx.full.min.js')],
  [/chart\.js@[\d.]+\/dist\/chart\.umd(\.min)?\.js/, path.join(NM, 'chart.js/dist/chart.umd.js')],
];

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const USER = {
  id: '00000000-0000-4000-8000-0000000000aa',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.test',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// A fake (unsigned) JWT that supabase-js will happily parse client-side.
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp })}.fake-signature`;
  return {
    access_token: token,
    refresh_token: 'fake-refresh-token',
    token_type: 'bearer',
    expires_in: 3600 * 24,
    expires_at: exp,
    user: USER,
  };
}

const now = new Date();
const daysAgo = n => new Date(now.getTime() - n * 86400000).toISOString();
const CUSTOMER = {
  id: '00000000-0000-4000-8000-0000000000c1', tenant_id: TENANT_ID,
  name: 'Test Customer', email: 'customer@example.test', phone: '412-555-0100',
  venmo_handle: '@test-customer', total_drops: 1, created_at: daysAgo(10),
};
const DROPOFFS = [
  { stage: 'intake' }, { stage: 'tagging', tagged_at: null },
  { stage: 'pricing', tagged_at: daysAgo(2), item_count: 3,
    pricing_lines: [{ brand: 'Test Brand', type: 'Tshirt', size: 'Kid', tier: 'Good', price: 6, qty: 2 }] },
  { stage: 'awaiting_customer', offer_sent_at: daysAgo(3), venmo_amount: 3.6, credit_amount: 4.8, offer_token: 'tok' },
  { stage: 'awaiting_customer', offer_sent_at: daysAgo(1), customer_responded_at: daysAgo(0),
    payment_choice: 'cash', leftover_choice: 'pickup', venmo_amount: 3.6, credit_amount: 4.8 },
  { stage: 'awaiting_pickup', paid_at: daysAgo(5), payment_choice: 'credit', leftover_choice: 'pickup', venmo_amount: 3, credit_amount: 4 },
  { stage: 'resolved', paid_at: daysAgo(8), resolved_at: daysAgo(8), payment_choice: 'cash', leftover_choice: 'donate', venmo_amount: 9, credit_amount: 12 },
].map((d, i) => Object.assign({
  id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
  tenant_id: TENANT_ID, customer_id: CUSTOMER.id, customer: CUSTOMER,
  drop_type: 'standard', donate_all: false, bag_description: `Test bag ${i}`,
  dropped_at: daysAgo(10 - i), notes: '', pricing_lines: [], deleted_at: null,
}, d));

const PRICING_CONFIG = {
  data: {
    brands: { 'Test Brand': 'Good', 'Nope Brand': 'DO NOT BUY' },
    types: ['Tshirt', 'Pants'],
    sizes: ['Baby', 'Kid'],
    pricingTiers: ['Good', 'Better'],
    pricing: { Good: { Tshirt: { Baby: 4, Kid: 6 }, Pants: { Baby: 5, Kid: 7 } },
               Better: { Tshirt: { Baby: 6, Kid: 8 }, Pants: { Baby: 7, Kid: 9 } } },
  },
};
const SETTINGS = {
  tenant_id: TENANT_ID, store_name: 'Test Shop', cash_pct: 0.30, credit_pct: 0.40,
  reminder_days: 4, auto_donate_days: 7, bulk_item_price: 0.5, bulk_onesie_price: 0.25,
  shoe_condition_excellent: 1, shoe_condition_gently_used: 0.75, shoe_condition_not_great: 0.5,
  baby_carrier_divisor: 3, hat_flat_price: 4, business_rules: {}, admin_password_hash: null,
};

function rpcResponse(name) {
  switch (name) {
    case 'my_tenants':
      return [{ tenant_id: TENANT_ID, slug: 'test-shop', name: 'Test Shop', role: 'owner', onboarded_at: daysAgo(30) }];
    case 'get_shop_public':
      return [{ name: 'Test Shop', slug: 'test-shop' }];
    case 'get_offer_by_token':
      return [{ customer_name: 'Test Customer', drop_type: 'standard', bag_description: 'Blue tote',
                venmo_amount: 3.6, credit_amount: 4.8, donate_all: false, customer_responded_at: null }];
    case 'create_intake':
      return '00000000-0000-4000-8000-0000000009aa';
    case 'respond_to_offer':
      return true;
    default:
      return [];
  }
}

function restResponse(table, wantsObject, params) {
  let rows;
  if (table === 'pricing_config') rows = [PRICING_CONFIG];
  else if (table === 'settings') rows = [SETTINGS];
  else if (table === 'dropoffs') rows = DROPOFFS;
  else if (table === 'customers') rows = [CUSTOMER];
  else rows = [];
  // Honour the simple PostgREST filters the app uses (col=eq.x, neq.x, is.null)
  // so e.g. the "active" and "recent resolved" queries don't duplicate rows.
  if (params) {
    for (const [key, val] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'tenant_id'].includes(key)) continue;
      const m = /^(eq|neq|is)\.(.*)$/.exec(val);
      if (!m) continue;
      const [, op, raw] = m;
      const want = raw === 'null' ? null : raw;
      rows = rows.filter(r => {
        const have = r[key] === undefined ? null : r[key];
        if (op === 'neq') return String(have) !== String(want);
        return want === null ? have === null : String(have) === String(want);
      });
    }
  }
  return wantsObject ? (rows[0] || null) : rows;
}

/**
 * Install all offline routes on a BrowserContext.
 * Returns a `log` object recording which Supabase project refs were contacted
 * and any request that tried to invoke an Edge Function.
 */
async function installMocks(context) {
  const log = { refs: new Set(), functionCalls: [], unexpectedHosts: new Set() };

  await context.route('https://cdn.jsdelivr.net/**', async route => {
    const url = route.request().url();
    const hit = CDN_FILES.find(([re]) => re.test(url));
    if (!hit || !fs.existsSync(hit[1])) {
      log.unexpectedHosts.add(url);
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(hit[1]) });
  });

  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* fonts mocked in smoke test */' }));

  await context.route(/https:\/\/[a-z0-9]+\.supabase\.co\/.*/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    log.refs.add(url.hostname.split('.')[0]);
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: JSON.stringify(body),
    });
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
    }
    const p = url.pathname;
    if (p.startsWith('/functions/v1/')) {
      // Edge functions (send-offer-email, onboarding-assistant, ...) are never
      // called for real; record and refuse.
      log.functionCalls.push(p);
      return json({ error: 'edge functions are disabled in the smoke test' }, 403);
    }
    if (p.startsWith('/auth/v1/')) {
      if (p.endsWith('/user')) return json(USER);
      if (p.endsWith('/token')) return json(fakeSession());
      if (p.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
      return json({});
    }
    if (p.startsWith('/rest/v1/rpc/')) return json(rpcResponse(p.split('/').pop()));
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/')[3];
      const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      if (req.method() === 'GET' || req.method() === 'HEAD') return json(restResponse(table, wantsObject, url.searchParams));
      return json(wantsObject ? {} : []);  // writes: pretend success
    }
    return json({});
  });

  return log;
}

/** Put a fake signed-in session in localStorage for both project refs. */
async function signInFake(context) {
  const session = fakeSession();
  await context.addInitScript(([s, refs]) => {
    for (const ref of refs) {
      try { localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)); } catch (_) {}
    }
  }, [session, [LIVE_REF, STAGING_REF]]);
}

module.exports = { installMocks, signInFake, LIVE_REF, STAGING_REF };
