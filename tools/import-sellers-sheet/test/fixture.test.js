'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseCsv } = require('../lib/csv');
const { buildPlan } = require('../lib/plan');
const { summarize } = require('../lib/report');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'fixtures', 'form-responses-5.sample.csv');

// Values allowed by live's check constraints (+ 'awaiting_pickup' from migration 0004).
const STAGES = ['intake', 'tagging', 'pricing', 'awaiting_customer', 'awaiting_pickup', 'resolved', 'cancelled'];
const PAY = [null, 'cash', 'credit', 'none'];
const LEFT = [null, 'pickup', 'donate', 'bulk', 'took_all'];

test('fixture is synthetic only (no real-looking contact data)', () => {
  const rows = parseCsv(fs.readFileSync(FIXTURE, 'utf8')).slice(1);
  for (const r of rows) {
    if (r[2]) assert.match(r[2], /^Test Seller \d{4}$/);
    if (r[3]) assert.match(r[3], /example\.test$/i);
    if (r[4] && r[4] !== 'n/a') assert.match(r[4].replace(/\D/g, '').slice(-10), /^5550100\d{3}$/);
  }
});

test('fixture generator is deterministic and matches the committed file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-'));
  const copy = path.join(tmp, 'gen.js');
  // Run the generator against a temp copy so the committed fixture is untouched.
  const src = fs.readFileSync(path.join(ROOT, 'fixtures', 'generate-sample.js'), 'utf8')
    .replace("require('../lib/csv')", JSON.stringify(path.join(ROOT, 'lib', 'csv')).replace(/^/, 'require(') + ')')
    .replace("path.join(__dirname, 'form-responses-5.sample.csv')", JSON.stringify(path.join(tmp, 'out.csv')));
  fs.writeFileSync(copy, src);
  execFileSync(process.execPath, [copy], { stdio: 'ignore' });
  assert.equal(fs.readFileSync(path.join(tmp, 'out.csv'), 'utf8'), fs.readFileSync(FIXTURE, 'utf8'));
});

test('fixture plan: counts, reconciliation and valid enum values', () => {
  const plan = buildPlan(parseCsv(fs.readFileSync(FIXTURE, 'utf8')));
  const s = summarize(plan);
  assert.equal(s.data_rows, 224);
  assert.equal(s.blank_rows, 1);
  assert.equal(s.dropoffs_to_add, 139);
  assert.deepEqual(s.skipped_by_reason, { before_cutoff: 81, duplicate_in_file: 1, timestamp_unparsed: 1, no_identity: 1 });
  assert.equal(s.customers_in_file, 78);
  assert.deepEqual(s.dropoffs_by_month, { '2026-05': 6, '2026-06': 24, '2026-07': 26, '2026-08': 25, '2026-09': 40, '2026-10': 18 });
  assert.equal(s.total_venmo_amount, 2627.5);
  assert.equal(s.total_credit_amount, 3534);
  assert.equal(s.open_bags, 56);
  assert.deepEqual(s.dropoffs_by_stage, { resolved: 83, awaiting_customer: 34, awaiting_pickup: 14, intake: 4, pricing: 4 });
  for (const d of plan.dropoffs) {
    assert.ok(STAGES.includes(d.stage), d.stage);
    assert.ok(PAY.includes(d.payment_choice), d.payment_choice);
    assert.ok(LEFT.includes(d.leftover_choice), d.leftover_choice);
    assert.ok(['standard', 'bulk'].includes(d.drop_type));
    assert.ok(d.dropped_at >= '2026-05-26T04:00:00.000Z');
    if (d.stage === 'resolved') assert.ok(d.resolved_at, `row ${d.row_no} resolved without resolved_at`);
    if (d.stage === 'awaiting_pickup') assert.ok(d.paid_at || d.payment_choice === 'none');
    if (d.paid_at) assert.ok(['cash', 'credit'].includes(d.payment_choice));
  }
  // Every messy variant in the fixture surfaces as a flag.
  for (const f of ['cash_not_confirmed_paid', 'payment_pending_or_uncertain', 'payment_split_or_ambiguous',
    'payment_other_method', 'leftover_pending_or_uncertain', 'leftover_none_assumed_no_leftovers',
    'kept_open_for_review', 'paid_method_assumed_venmo', 'leftover_unrecognized', 'email_sent_unparsed',
    'email_sent_far_after_dropoff', 'amount_unparsed', 'bulk_but_donate_no', 'email_invalid', 'name_missing',
    'no_email_matched_by_phone', 'paid_no_leftover_decision']) {
    assert.ok(s.flags[f] > 0, `expected flag ${f}`);
  }
});

test('CLI dry run prints report and writes nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
  const out = execFileSync(process.execPath, [path.join(ROOT, 'import.js'), '--input', FIXTURE, '--dry-run',
    '--out-sql', path.join(tmp, 'x.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(out, /DRY RUN/);
  assert.match(out, /to add:\s+139/);
  assert.match(out, /open bags \(not resolved\/cancelled\): 56/);
  assert.doesNotMatch(out, /example\.test|Test Seller/);   // report never prints contact data
  assert.equal(fs.existsSync(path.join(tmp, 'x.sql')), false);
});
