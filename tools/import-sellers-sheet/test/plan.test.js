'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan } = require('../lib/plan');
const { summarize } = require('../lib/report');

const HEADER = ['/', 'I understand Dandelion Kids ...', 'Name (First and last)', 'Email', 'Phone Number', 'Drop Off Type',
  'Donate?', 'Bag Description', 'T', 'P', 'Email Sent', 'Venmo Amount', 'Store Credit Amount', 'Venmo or Credit', 'Pick Up or Donate', 'notes'];

// Build a row: positional overrides on top of a sane default.
function row(ts, n, o = {}) {
  const r = [ts, 'I consent to sell all items', `Test Seller ${n}`, `seller${n}@example.test`, `555-010-${n}`,
    '25 or Less', "NO. I'd like to see my offer", 'Test bag', '', '', '', '', '', '', '', ''];
  for (const [k, v] of Object.entries(o)) r[+k] = v;
  return r;
}
const plan = rows => buildPlan([HEADER, ...rows]);
const only = rows => { const p = plan(rows); assert.equal(p.dropoffs.length, 1, JSON.stringify(p.skipped)); return p.dropoffs[0]; };

test('cutoff: rows before 2026-05-26 (shop time) are skipped', () => {
  const p = plan([
    row('5/25/2026 23:59:59', '0001'),
    row('5/26/2026 0:00:00', '0002'),
    row('1/2/2026 10:00:00', '0003'),
  ]);
  assert.equal(p.dropoffs.length, 1);
  assert.equal(p.dropoffs[0].row_no, 3);
  assert.deepEqual(p.skipped.map(s => s.reason), ['before_cutoff', 'before_cutoff']);
});

test('stage: new / tagged / priced / emailed', () => {
  assert.equal(only([row('6/1/2026 10:00:00', '0001')]).stage, 'intake');
  const t = only([row('6/1/2026 10:00:00', '0001', { 8: 'x' })]);
  assert.equal(t.stage, 'pricing'); assert.ok(t.tagged_at); assert.equal(t.priced_at, null);
  const p = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'X', 11: '$9', 12: '$12' })]);
  assert.equal(p.stage, 'pricing'); assert.ok(p.priced_at); assert.equal(p.offer_sent_at, null);
  const e = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 11: '$9', 12: '$12' })]);
  assert.equal(e.stage, 'awaiting_customer');
  assert.equal(e.offer_sent_at, '2026-06-03T16:00:00.000Z');
  assert.equal(e.customer_responded_at, null);
});

test('stage: paid + donated / picked up / took all -> resolved', () => {
  const d = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 11: '9', 12: '12', 13: 'credited', 14: 'donated 6/12' })]);
  assert.equal(d.stage, 'resolved');
  assert.equal(d.payment_choice, 'credit');
  assert.equal(d.leftover_choice, 'donate');
  assert.equal(d.resolved_at, '2026-06-12T16:00:00.000Z');
  assert.ok(d.paid_at && d.customer_responded_at);
  const pu = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 13: 'Venmoed', 14: 'Picked up' })]);
  assert.equal(pu.stage, 'resolved'); assert.equal(pu.payment_choice, 'cash'); assert.equal(pu.leftover_choice, 'pickup');
  assert.ok(pu.picked_up_at);
  const ta = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 13: 'CREDITED', 14: 'took all' })]);
  assert.equal(ta.leftover_choice, 'took_all'); assert.equal(ta.stage, 'resolved');
});

test('stage: paid + "picking up" -> awaiting_pickup (paid, not resolved)', () => {
  const d = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 13: 'credited', 14: 'picking up' })]);
  assert.equal(d.stage, 'awaiting_pickup');
  assert.ok(d.paid_at);
  assert.equal(d.resolved_at, null);
  assert.equal(d.leftover_choice, 'pickup');
});

test('stage: "cash" without "venmoed" stays open as Ready to Pay and is flagged', () => {
  const p = plan([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 13: 'cash', 14: 'donated' })]);
  const d = p.dropoffs[0];
  assert.equal(d.stage, 'awaiting_customer');
  assert.equal(d.payment_choice, 'cash');
  assert.ok(d.customer_responded_at);
  assert.equal(d.paid_at, null);
  assert.ok(d.flags.includes('cash_not_confirmed_paid'));
});

test('stage: took none / auto-donated / bulk', () => {
  const tn = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 13: 'took none', 14: 'picked up' })]);
  assert.equal(tn.stage, 'resolved'); assert.equal(tn.payment_choice, 'none'); assert.equal(tn.paid_at, null);
  const ad = only([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 14: 'Donated' })]);
  assert.equal(ad.stage, 'resolved'); assert.equal(ad.payment_choice, null); assert.equal(ad.leftover_choice, 'donate');
  const bk = only([row('6/1/2026 10:00:00', '0001', { 5: 'Bulk', 6: 'Not applicable - I have a bulk drop off', 10: '6/2', 11: '$20', 12: '$30', 13: 'venmoed', 14: 'bulk' })]);
  assert.equal(bk.drop_type, 'bulk'); assert.equal(bk.donate_all, true);
  assert.equal(bk.stage, 'resolved'); assert.equal(bk.leftover_choice, 'bulk'); assert.equal(bk.payment_choice, 'cash');
  assert.ok(!bk.flags.includes('amount_without_p_mark'));
  const nl = only([row('6/1/2026 10:00:00', '0001', { 5: 'bulk', 6: 'Not applicable', 13: 'credited', 14: 'no leftovers' })]);
  assert.equal(nl.stage, 'resolved'); assert.equal(nl.leftover_choice, null);
});

test('unrecognized text is flagged and preserved in notes', () => {
  const p = plan([row('6/1/2026 10:00:00', '0001', { 8: 'x', 9: 'x', 10: '6/3', 13: 'split 50/50', 14: 'in back room', 15: 'orig note' })]);
  const d = p.dropoffs[0];
  assert.ok(d.flags.includes('payment_unrecognized'));
  assert.ok(d.flags.includes('leftover_unrecognized'));
  assert.match(d.notes, /^orig note\n\[sheet import\] Venmo or Credit: "split 50\/50"; Pick Up or Donate: "in back room"$/);
  assert.equal(d.stage, 'awaiting_customer');
});

test('customers: dedupe by lowercased email, then digits-only phone', () => {
  const p = plan([
    row('6/1/2026 10:00:00', '0001'),
    row('6/8/2026 10:00:00', '0001', { 3: 'SELLER0001@Example.test', 4: '(555) 010-0001' }),
    row('6/2/2026 10:00:00', '0002', { 3: '' }),
    row('6/9/2026 10:00:00', '0002', { 3: '', 4: '+1 555.010.0002' }),
    row('6/3/2026 10:00:00', '0003'),
  ]);
  assert.equal(p.dropoffs.length, 5);
  assert.equal(p.customers.length, 3);
  const byKey = Object.fromEntries(p.customers.map(c => [c.key, c]));
  assert.deepEqual(byKey['email:seller0001@example.test'].rows, [2, 3]);
  assert.deepEqual(byKey['phone:5550100002'].rows, [4, 5]);
  assert.equal(byKey['phone:5550100002'].email, null);
});

test('idempotency inside the file and against --existing keys', () => {
  const rows = [
    row('6/1/2026 10:00:00', '0001'),
    row('6/1/2026 10:00:00', '0001'),               // exact duplicate
    row('6/2/2026 10:00:00', '0002'),
    row('6/3/2026 10:00:00', '0003', { 3: '' }),    // phone-only customer
  ];
  const p1 = plan(rows);
  assert.equal(p1.dropoffs.length, 3);
  assert.deepEqual(p1.skipped, [{ row: 3, reason: 'duplicate_in_file' }]);
  const existing = {
    customers: [{ email: 'seller0001@example.test' }, { phone_digits: '5550100003' }],
    dropoffs: [
      { dropped_at: '2026-06-01T14:00:00Z', email: 'seller0001@example.test' },
      { dropped_at: '2026-06-03T14:00:00Z', phone_digits: '5550100003' },
    ],
  };
  const p2 = buildPlan([HEADER, ...rows], { existing });
  assert.equal(p2.dropoffs.length, 1);
  assert.equal(p2.dropoffs[0].row_no, 4);
  assert.deepEqual(p2.skipped.map(s => s.reason).sort(), ['already_in_database', 'already_in_database', 'duplicate_in_file']);
  const s = summarize(p2);
  assert.equal(s.customers_new, 1);
  assert.equal(s.customers_matched_existing, 0);
});

test('rows without any identity or timestamp are skipped; blank rows ignored', () => {
  const p = plan([
    row('6/1/2026 10:00:00', '0001', { 2: '', 3: '', 4: '' }),
    row('not a date', '0002'),
    new Array(16).fill(''),
  ]);
  assert.equal(p.dropoffs.length, 0);
  assert.deepEqual(p.skipped.map(s => s.reason), ['no_identity', 'timestamp_unparsed']);
  assert.equal(p.blankRows, 1);
});

test('header check warns on unexpected layout', () => {
  const p = buildPlan([['/', 'x', 'Name', 'Email'], row('6/1/2026 10:00:00', '0001')]);
  assert.ok(p.warnings.some(w => /expected 16/.test(w)));
});

test('typo in Email Sent (earlier than drop-off) falls back to the drop-off date, never a future year', () => {
  const p = plan([row('9/20/2026 13:00:00', '0001', { 8: 'X', 9: 'X', 10: '9/2', 11: '$9', 12: '$12' })]);
  const d = p.dropoffs[0];
  assert.equal(d.offer_sent_at, d.dropped_at);
  assert.ok(d.flags.includes('email_sent_far_after_dropoff'));
  assert.match(d.notes, /Email Sent: "9\/2"/);
});

test('QC: pending / questioned / split / other-method values never close a bag', () => {
  const base = { 8: 'x', 9: 'x', 10: '6/3', 11: '$10', 12: '$14' };
  const d = (pay, left) => only([row('6/1/2026 10:00:00', '0001', { ...base, 13: pay, 14: left })]);
  for (const pay of ['Venmo pending', 'venmo?', 'will venmo', 'credit next visit?']) {
    const x = d(pay, 'donated');
    assert.equal(x.stage, 'awaiting_customer', pay);
    assert.equal(x.paid_at, null, pay);
    assert.ok(x.flags.includes('payment_pending_or_uncertain'), pay);
  }
  for (const [pay, flag] of [['Credited/Venmoed', 'payment_split_or_ambiguous'], ['PayPal', 'payment_other_method'], ['check', 'payment_other_method']]) {
    const x = d(pay, 'donated');
    assert.equal(x.stage, 'awaiting_customer', pay);
    assert.equal(x.payment_choice, null, pay);
    assert.equal(x.paid_at, null, pay);
    assert.ok(x.flags.includes(flag) && x.flags.includes('kept_open_for_review'), pay);
    assert.match(x.notes, /\[sheet import\] Venmo or Credit:/);
  }
  // Paid, but leftovers still uncertain -> awaiting_pickup (staff decide), not resolved.
  for (const left of ['donating', 'donated?']) {
    const x = d('credited', left);
    assert.equal(x.stage, 'awaiting_pickup', left);
    assert.equal(x.resolved_at, null, left);
    assert.ok(x.paid_at, left);
    assert.ok(x.flags.includes('leftover_pending_or_uncertain'), left);
  }
  const unpaidDonate = d('', 'donate');
  assert.equal(unpaidDonate.stage, 'awaiting_customer');
});

test('QC: "paid" / "Paid venmo" -> cash paid; pickup spellings -> awaiting pickup; none/N/A -> no leftovers (flagged)', () => {
  const base = { 8: 'x', 9: 'x', 10: '6/3' };
  const d = (pay, left) => only([row('6/1/2026 10:00:00', '0001', { ...base, 13: pay, 14: left })]);
  const paid = d('paid', 'donated');
  assert.equal(paid.stage, 'resolved'); assert.equal(paid.payment_choice, 'cash'); assert.ok(paid.flags.includes('paid_method_assumed_venmo'));
  const pv = d('Paid venmo', 'donated');
  assert.equal(pv.stage, 'resolved'); assert.equal(pv.payment_choice, 'cash'); assert.deepEqual(pv.flags, []);
  for (const left of ['Pick up', 'pickup', 'will pick up', 'picking up']) {
    const x = d('credited', left);
    assert.equal(x.stage, 'awaiting_pickup', left);
    assert.equal(x.leftover_choice, 'pickup', left);
    assert.equal(x.resolved_at, null, left);
  }
  for (const left of ['none', 'N/A']) {
    const x = d('venmoed', left);
    assert.equal(x.stage, 'resolved', left);
    assert.equal(x.leftover_choice, null, left);
    assert.ok(x.flags.includes('leftover_none_assumed_no_leftovers'), left);
  }
});

test('QC: T/P "1" and "done" count as yes', () => {
  const x = only([row('6/1/2026 10:00:00', '0001', { 8: '1', 9: 'done', 11: '$9', 12: '$12' })]);
  assert.ok(x.tagged_at && x.priced_at);
  assert.deepEqual(x.flags, []);
});
