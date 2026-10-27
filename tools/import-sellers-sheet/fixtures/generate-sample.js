#!/usr/bin/env node
'use strict';
// Generates fixtures/form-responses-5.sample.csv: ~200 SYNTHETIC rows in the
// exact 16-column layout of the "Form Responses 5" tab. Deterministic (seeded
// PRNG) so tests can assert exact numbers. No real people: names are
// "Test Seller NNNN", emails sellerNNNN@example.test, phones 555-010-NNNN.

const fs = require('fs');
const path = require('path');
const { toCsv } = require('../lib/csv');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261026);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w = 4) => String(n).padStart(w, '0');

const HEADER = [
  '/',
  'I understand Dandelion Kids will review my items and email me an offer. Items not purchased will be donated or returned as selected below.',
  'Name (First and last)',
  'Email',
  'Phone Number',
  'Drop Off Type',
  'Would you like us to donate all unsold items?',
  'Bag Description',
  'T',
  'P',
  'Email Sent',
  'Venmo Amount',
  'Store Credit Amount',
  'Venmo or Credit',
  'Pick Up or Donate',
  'notes',
];

const CONSENT = ['I understand Dandelion Kids will review my items and email me an offer.', 'I consent to sell all items'];
const DONATE_YES = ['YES Please donate all unsold items', 'yes please donate all unsold items', 'YES please donate all unsold items'];
const DONATE_NO = ["NO. I'd like to see my offer and decide what to do with unsold items", "no. i'd like to see my offer first"];
const DONATE_BULK = ['Not applicable - I have a bulk drop off', 'not applicable - i have a bulk drop off'];
const STD_TYPES = ['25 or Less', '25 or Less', '25 or Less', '25 or less', '25 or Less- process as 25 or less'];
const BULK_TYPES = ['Bulk', 'Bulk', 'bulk'];
const BAGS = ['Blue IKEA bag', 'Two grocery bags', 'Black trash bag, girls 2T-3T', 'Laundry basket', 'Target bag, boys 4T', 'Box of shoes', 'Tote with "Mom life" print', 'Purple duffel, baby 0-12m'];
const YES_MARK = ['x', 'X', 'x', 'X '];
const NO_MARK = ['', '', '-', '--', 'na', 'n/a'];
const CREDITED = ['credited', 'CREDITED', 'Credited'];
const VENMOED = ['venmoed', 'Venmoed', 'venmo'];
const DONATED = ['donated', 'Donated'];
const PICKED = ['picked up', 'Picked up'];

// People: 70 synthetic sellers; some repeat. A few have quirks.
const people = [];
for (let i = 1; i <= 70; i++) {
  people.push({
    name: `Test Seller ${pad(i)}`,
    email: `seller${pad(i)}@example.test`,
    phone: pick([`555-010-${pad(i)}`, `(555) 010-${pad(i)}`, `555.010.${pad(i)}`, `+1 555 010 ${pad(i)}`]),
  });
}
people[6].emailVariant = 'Seller0007@Example.TEST';   // case variant on a repeat visit
people[11].email = '';                                  // no email -> matched by phone
people[12].email = 'seller0013-at-example.test';        // invalid email
people[13].name = '';                                   // missing name
people[14].phone = 'n/a';

function fmtTs(y, mo, d, h, mi, s) {
  return `${mo}/${d}/${y} ${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Day-of-year helpers for 2026.
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function addDays(mo, d, n) {
  let m = mo, dd = d + n;
  while (dd > DAYS[m - 1]) { dd -= DAYS[m - 1]; m++; }
  return [m, dd];
}

function scenarioFor(ageDays, isBulk) {
  // Older drop-offs are mostly finished; recent ones are open.
  const r = rnd();
  if (ageDays > 21) {
    if (isBulk) return r < 0.6 ? 'bulk_paid' : r < 0.85 ? 'bulk_paid_donated' : 'bulk_none';
    if (r < 0.40) return 'paid_donated';
    if (r < 0.62) return 'paid_picked';
    if (r < 0.70) return 'paid_took_all';
    if (r < 0.76) return 'auto_donated';
    if (r < 0.80) return 'took_none';
    if (r < 0.84) return 'paid_picking_up';
    if (r < 0.87) return 'cash_unconfirmed';
    if (r < 0.90) return 'paid_no_leftover';
    if (r < 0.93) return 'messy_payment';
    if (r < 0.96) return 'messy_leftover';
    return 'emailed';
  }
  if (isBulk) return r < 0.5 ? 'bulk_new' : 'bulk_paid';
  if (r < 0.18) return 'new';
  if (r < 0.32) return 'tagged';
  if (r < 0.44) return 'priced';
  if (r < 0.66) return 'emailed';
  if (r < 0.74) return 'emailed_unparsed';
  if (r < 0.84) return 'paid_picking_up';
  if (r < 0.92) return 'paid_donated';
  return 'cash_unconfirmed';
}

function amounts() {
  const resale = 15 + Math.floor(rnd() * 120) + (rnd() < 0.5 ? 0.5 : 0);
  const v = Math.round(resale * 0.3 * 100) / 100;
  const c = Math.round(resale * 0.4 * 100) / 100;
  const fmt = n => pick([`$${n.toFixed(2)}`, `${n}`, `$${n.toFixed(2)}`]);
  return [fmt(v), fmt(c)];
}

const rows = [HEADER];
const TODAY = [10, 26];
let n = 0;
// 80 rows Jan 5 - May 25 (already on live -> must be skipped), 118 rows May 26 - Oct 25.
const plan = [];
for (let i = 0; i < 80; i++) { const doy = 4 + Math.floor((i / 80) * 140); plan.push(doy); }
for (let i = 0; i < 118; i++) { const doy = 145 + Math.floor((i / 118) * 152); plan.push(doy); }

for (const doy of plan) {
  n++;
  let [mo, d] = addDays(1, 1, doy);
  const p = people[Math.floor(rnd() * people.length)];
  const isBulk = rnd() < 0.12;
  const h = 9 + Math.floor(rnd() * 9), mi = Math.floor(rnd() * 60), s = Math.floor(rnd() * 60);
  const ts = fmtTs(2026, mo, d, h, mi, s);
  const doyToday = 298;
  const age = doyToday - doy;
  const sc = scenarioFor(age, isBulk);
  const [venmoAmt, creditAmt] = amounts();
  const sentDay = addDays(mo, d, 1 + Math.floor(rnd() * 4));
  const sent = `${sentDay[0]}/${sentDay[1]}`;
  const leftDay = addDays(sentDay[0], sentDay[1], 7);

  const row = new Array(16).fill('');
  row[0] = ts;
  row[1] = pick(CONSENT);
  row[2] = p.name;
  row[3] = p.emailVariant && rnd() < 0.5 ? p.emailVariant : p.email;
  row[4] = p.phone;
  row[5] = isBulk ? pick(BULK_TYPES) : pick(STD_TYPES);
  row[6] = isBulk ? pick(DONATE_BULK) : (rnd() < 0.55 ? pick(DONATE_YES) : pick(DONATE_NO));
  row[7] = pick(BAGS);
  row[8] = pick(NO_MARK); row[9] = pick(NO_MARK);
  const T = () => { row[8] = pick(YES_MARK); };
  const Pm = () => { T(); row[9] = pick(YES_MARK); };
  const priced = () => { Pm(); row[11] = venmoAmt; row[12] = creditAmt; };
  const emailed = () => { priced(); row[10] = sent; };

  switch (sc) {
    case 'new': break;
    case 'tagged': T(); break;
    case 'priced': priced(); break;
    case 'emailed': emailed(); break;
    case 'emailed_unparsed': emailed(); row[10] = pick(['sent', 'yes', 'emailed']); break;
    case 'paid_donated': emailed(); row[13] = pick(rnd() < 0.7 ? CREDITED : VENMOED); row[14] = rnd() < 0.3 ? `donated ${leftDay[0]}/${leftDay[1]}` : pick(DONATED); break;
    case 'paid_picked': emailed(); row[13] = pick(rnd() < 0.7 ? CREDITED : VENMOED); row[14] = pick(PICKED); break;
    case 'paid_took_all': emailed(); row[13] = pick(CREDITED); row[14] = 'took all'; break;
    case 'paid_picking_up': emailed(); row[13] = pick(rnd() < 0.7 ? CREDITED : VENMOED); row[14] = 'picking up'; break;
    case 'auto_donated': emailed(); row[14] = pick(DONATED); break;
    case 'took_none': emailed(); row[13] = pick(['took none', 'none', 'n/a']); row[14] = pick(['picked up', 'donated']); break;
    case 'cash_unconfirmed': emailed(); row[13] = 'cash'; row[14] = pick(['donated', 'picking up', '']); break;
    case 'paid_no_leftover': emailed(); row[13] = pick(CREDITED); break;
    case 'messy_payment': emailed(); row[13] = pick(['split 50/50 credit+venmo', 'credit next visit?', 'Venmo pending']); row[14] = pick(DONATED); break;
    case 'messy_leftover': emailed(); row[13] = pick(CREDITED); row[14] = pick(['maybe donate?', 'call her', 'in back room']); break;
    case 'bulk_new': break;
    case 'bulk_paid': row[11] = venmoAmt; row[12] = creditAmt; row[10] = sent; row[13] = pick(rnd() < 0.5 ? CREDITED : VENMOED); row[14] = pick(['bulk', 'no leftovers']); break;
    case 'bulk_paid_donated': row[11] = venmoAmt; row[12] = creditAmt; row[10] = sent; row[13] = pick(CREDITED); row[14] = pick(DONATED); break;
    case 'bulk_none': row[10] = sent; row[13] = 'took none'; row[14] = 'bulk'; break;
    default: throw new Error(sc);
  }
  if (rnd() < 0.15) row[15] = pick(['Has stains on 2 items', 'Returning customer, likes credit', 'Said "no rush", will text', 'Shoes in separate bag,\nfront counter']);
  rows.push(row);
}

// Hand-written edge cases (synthetic).
const edge = (ts, name, email, phone, type, donate, extra = {}) => {
  const r = new Array(16).fill('');
  r[0] = ts; r[1] = CONSENT[0]; r[2] = name; r[3] = email; r[4] = phone; r[5] = type; r[6] = donate; r[7] = 'Edge case bag';
  for (const [k, v] of Object.entries(extra)) r[+k] = v;
  rows.push(r);
};
// Boundary: last second before cutoff (skip) and first seconds after (import).
edge('5/25/2026 23:59:59', 'Test Seller 0091', 'seller0091@example.test', '555-010-0091', '25 or Less', DONATE_YES[0]);
edge('5/26/2026 0:00:05', 'Test Seller 0092', 'seller0092@example.test', '555-010-0092', '25 or Less', DONATE_NO[0]);
// Exact duplicate submission (same timestamp + email) -> second is skipped.
edge('6/3/2026 10:15:00', 'Test Seller 0093', 'seller0093@example.test', '555-010-0093', '25 or Less', DONATE_YES[0], { 8: 'x' });
edge('6/3/2026 10:15:00', 'Test Seller 0093', 'seller0093@example.test', '555-010-0093', '25 or Less', DONATE_YES[0], { 8: 'x' });
// Typo'd Email Sent (before the drop-off month/day -> inferred next year -> flagged).
edge('9/20/2026 13:00:00', 'Test Seller 0094', 'seller0094@example.test', '555-010-0094', '25 or Less', DONATE_YES[0], { 8: 'X', 9: 'X', 10: '9/2', 11: '$9.00', 12: '$12.00' });
// Unparseable amount.
edge('7/14/2026 11:30:00', 'Test Seller 0095', 'seller0095@example.test', '555-010-0095', '25 or Less', DONATE_NO[1], { 8: 'x', 9: 'x', 10: '7/16', 11: 'tbd', 12: '$20.00' });
// Bulk with the donate question answered "NO".
edge('8/1/2026 9:05:00', 'Test Seller 0096', 'seller0096@example.test', '555-010-0096', 'Bulk', DONATE_NO[0]);
// Unparseable timestamp (skip) and a blank row.
edge('sometime in June', 'Test Seller 0097', 'seller0097@example.test', '555-010-0097', '25 or Less', DONATE_YES[0]);
rows.push(new Array(16).fill(''));
// No name, no email, no phone -> skip (no identity).
edge('8/15/2026 16:45:00', '', '', '', '25 or Less', DONATE_YES[0]);

const out = path.join(__dirname, 'form-responses-5.sample.csv');
fs.writeFileSync(out, toCsv(rows));
process.stdout.write(`wrote ${out} (${rows.length - 1} data rows)\n`);
