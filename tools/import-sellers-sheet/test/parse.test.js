'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/parse');
const { parseCsv, toCsv } = require('../lib/csv');

test('csv: quotes, embedded commas/newlines, CRLF, BOM', () => {
  const text = '﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n,,\r\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2'], ['', '', '']]);
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
  assert.throws(() => parseCsv('"unterminated'), /unterminated/);
});

test('timestamp: Google Forms format in shop time (EDT/EST)', () => {
  assert.equal(P.parseTimestamp('5/27/2026 14:03:11').value, '2026-05-27T18:03:11.000Z'); // EDT -4
  assert.equal(P.parseTimestamp('1/5/2026 9:00:00').value, '2026-01-05T14:00:00.000Z');   // EST -5
  assert.equal(P.parseTimestamp('11/1/2026 1:30:00').value, '2026-11-01T05:30:00.000Z');  // ambiguous hour -> first (EDT)
  assert.equal(P.parseTimestamp('5/27/2026 2:03:11 PM').value, '2026-05-27T18:03:11.000Z');
  assert.equal(P.parseTimestamp('2026-05-27 14:03:11').value, '2026-05-27T18:03:11.000Z');
  assert.equal(P.parseTimestamp('5/27/2026').value, '2026-05-27T04:00:00.000Z');
  assert.equal(P.parseTimestamp('').flag, 'timestamp_missing');
  assert.equal(P.parseTimestamp('sometime in June').flag, 'timestamp_unparsed');
  assert.equal(P.parseTimestamp('2/30/2026 10:00:00').flag, 'timestamp_unparsed');
});

test('email sent: month/day without year, year inferred from drop-off', () => {
  const ref = { y: 2026, mo: 5, d: 27 };
  assert.equal(P.parseEmailSent('5/29', ref).value, '2026-05-29T16:00:00.000Z');
  assert.equal(P.parseEmailSent('10/10', ref).value, '2026-10-10T16:00:00.000Z');
  // Dropped Dec 28 2026, emailed "1/3" -> Jan 3 2027.
  assert.equal(P.parseEmailSent('1/3', { y: 2026, mo: 12, d: 28 }).value, '2027-01-03T17:00:00.000Z');
  // Same month, earlier day -> following year (likely a typo; planner flags it).
  assert.equal(P.parseEmailSent('5/2', ref).value.slice(0, 4), '2027');
  assert.equal(P.parseEmailSent('3/17/2026', ref).value, '2026-03-17T16:00:00.000Z');
  for (const blank of ['', '-', '--', 'na', 'n/a']) assert.deepEqual(P.parseEmailSent(blank, ref), { value: null, sent: false });
  assert.deepEqual(P.parseEmailSent('sent', ref), { value: null, sent: true, flag: 'email_sent_unparsed' });
});

test('T / P marks', () => {
  for (const y of ['x', 'X', ' X ', 'xx', '1', 'done', 'Done', 'yes']) assert.equal(P.parseMark(y).value, true, y);
  for (const n of ['', '-', '--', 'na', 'n/a', 'N/A']) assert.deepEqual(P.parseMark(n), { value: false }, n);
  assert.equal(P.parseMark('maybe').flag, 'mark_unrecognized');
});

test('amounts', () => {
  assert.equal(P.parseAmount('$12.50').value, 12.5);
  assert.equal(P.parseAmount('12.5').value, 12.5);
  assert.equal(P.parseAmount('$1,020.00').value, 1020);
  assert.equal(P.parseAmount('$0.00').value, 0);
  assert.equal(P.parseAmount('.75').value, 0.75);
  assert.equal(P.parseAmount('').value, null);
  assert.equal(P.parseAmount('-').value, null);
  assert.deepEqual(P.parseAmount('tbd'), { value: null, flag: 'amount_unparsed' });
});

test('drop off type', () => {
  assert.deepEqual(P.parseDropType('25 or Less'), { value: 'standard', flag: undefined });
  assert.equal(P.parseDropType('25 or Less- process as 25 or less').value, 'standard');
  assert.equal(P.parseDropType('25 or Less- process as 25 or less').flag, 'drop_type_variant');
  assert.deepEqual(P.parseDropType('Bulk'), { value: 'bulk', flag: undefined });
  assert.equal(P.parseDropType('bulk').value, 'bulk');
  assert.equal(P.parseDropType('???').flag, 'drop_type_unrecognized');
});

test('donate question', () => {
  assert.equal(P.parseDonate('YES Please donate all unsold items').value, 'yes');
  assert.equal(P.parseDonate('yes please donate').value, 'yes');
  assert.equal(P.parseDonate("NO. I'd like to see my offer and decide").value, 'no');
  assert.equal(P.parseDonate("no. i'd like to see my offer").value, 'no');
  assert.equal(P.parseDonate('Not applicable - I have a bulk drop off').value, 'bulk');
  assert.equal(P.parseDonate('').flag, 'donate_blank');
});

test('Venmo or Credit', () => {
  for (const v of ['credited', 'CREDITED', 'Credited', 'store credit', 'credited 6/3']) assert.deepEqual(P.parsePayment(v), { choice: 'credit', paid: true }, v);
  for (const v of ['venmoed', 'Venmoed', 'venmo', 'Paid venmo', 'venmo paid', 'paid via venmo']) assert.deepEqual(P.parsePayment(v), { choice: 'cash', paid: true }, v);
  assert.deepEqual(P.parsePayment('paid'), { choice: 'cash', paid: true, flag: 'paid_method_assumed_venmo' });
  assert.deepEqual(P.parsePayment('cash'), { choice: 'cash', paid: false, flag: 'cash_not_confirmed_paid' });
  for (const v of ['took none', 'none', 'n/a', 'N/A']) assert.deepEqual(P.parsePayment(v), { choice: 'none', paid: false }, v);
  assert.deepEqual(P.parsePayment(''), { choice: null, paid: false });
  // Pending / questioned / future tense: never paid, flagged for review.
  for (const [v, choice] of [['Venmo pending', 'cash'], ['venmo?', 'cash'], ['will venmo', 'cash'], ['credit next visit?', 'credit'], ['?', null], ['pending', null]]) {
    assert.deepEqual(P.parsePayment(v), { choice, paid: false, review: true, flag: 'payment_pending_or_uncertain' }, v);
  }
  for (const v of ['Credited/Venmoed', 'split 50/50 credit+venmo', 'credit + cash']) {
    assert.deepEqual(P.parsePayment(v), { choice: null, paid: false, review: true, flag: 'payment_split_or_ambiguous' }, v);
  }
  for (const v of ['PayPal', 'paypal', 'check', 'Check #1234', 'zelle']) {
    assert.deepEqual(P.parsePayment(v), { choice: null, paid: false, review: true, flag: 'payment_other_method' }, v);
  }
  assert.deepEqual(P.parsePayment('split 50/50'), { choice: null, paid: false, review: true, flag: 'payment_unrecognized' });
});

test('Pick Up or Donate', () => {
  const ref = { y: 2026, mo: 5, d: 27 };
  assert.equal(P.parseLeftover('donated', ref).leftover, 'donate');
  assert.equal(P.parseLeftover('Donated', ref).done, true);
  assert.equal(P.parseLeftover('donated 5/31', ref).date, '2026-05-31T16:00:00.000Z');
  assert.deepEqual(P.parseLeftover('picked up', ref), { kind: 'picked_up', leftover: 'pickup', done: true, date: null });
  assert.equal(P.parseLeftover('Picked up', ref).kind, 'picked_up');
  assert.equal(P.parseLeftover('took all', ref).leftover, 'took_all');
  for (const v of ['picking up', 'Pick up', 'pickup', 'will pick up', 'to pick up']) {
    assert.deepEqual(P.parseLeftover(v, ref), { kind: 'picking_up', leftover: 'pickup', done: false }, v);
  }
  assert.deepEqual(P.parseLeftover('bulk', ref), { kind: 'bulk', leftover: 'bulk', done: true });
  assert.deepEqual(P.parseLeftover('no leftovers', ref), { kind: 'no_leftovers', leftover: null, done: true });
  for (const v of ['none', 'N/A', 'n/a']) {
    assert.deepEqual(P.parseLeftover(v, ref), { kind: 'no_leftovers', leftover: null, done: true, flag: 'leftover_none_assumed_no_leftovers' }, v);
  }
  for (const v of ['donating', 'donated?', 'donate', 'maybe donate?', 'will donate', 'to donate']) {
    const x = P.parseLeftover(v, ref);
    assert.equal(x.done, false, v); assert.equal(x.review, true, v);
    assert.equal(x.leftover, 'donate', v); assert.equal(x.flag, 'leftover_pending_or_uncertain', v);
  }
  assert.equal(P.parseLeftover('picked up?', ref).done, false);
  assert.equal(P.parseLeftover('picked up?', ref).review, true);
  assert.deepEqual(P.parseLeftover('', ref), { kind: null, leftover: null, done: false });
  assert.equal(P.parseLeftover('in back room', ref).flag, 'leftover_unrecognized');
  assert.equal(P.parseLeftover('in back room', ref).review, true);
});

test('phone + email normalisation', () => {
  assert.deepEqual(P.parsePhone('555-010-0001'), { value: '(555) 010-0001', digits: '5550100001' });
  assert.deepEqual(P.parsePhone('+1 555 010 0001'), { value: '(555) 010-0001', digits: '5550100001' });
  assert.equal(P.parsePhone('555.010.0001').digits, '5550100001');
  assert.deepEqual(P.parsePhone('n/a'), { value: null, digits: null });
  assert.equal(P.parsePhone('12').flag, 'phone_invalid');
  assert.equal(P.parseEmail(' Seller0001@Example.TEST ').value, 'seller0001@example.test');
  assert.equal(P.parseEmail('seller-at-example.test').flag, 'email_invalid');
  assert.equal(P.parseEmail('').value, null);
});
