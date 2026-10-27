'use strict';
// Dry-run / reconciliation report. Prints counts and spreadsheet ROW NUMBERS
// only -- never names, emails or phone numbers -- so the output is safe to
// paste into a chat or ticket.

const P = require('./parse');

const OPEN = s => s !== 'resolved' && s !== 'cancelled';

function summarize(plan) {
  const byMonth = {};
  const byStage = {};
  let venmo = 0, credit = 0, open = 0;
  for (const d of plan.dropoffs) {
    const l = P.localDate(d.dropped_at, plan.tz);
    const m = `${l.y}-${String(l.mo).padStart(2, '0')}`;
    byMonth[m] = (byMonth[m] || 0) + 1;
    byStage[d.stage] = (byStage[d.stage] || 0) + 1;
    venmo += d.venmo_amount || 0;
    credit += d.credit_amount || 0;
    if (OPEN(d.stage)) open++;
  }
  const skippedBy = {};
  for (const s of plan.skipped) skippedBy[s.reason] = (skippedBy[s.reason] || 0) + 1;
  const newCustomers = plan.customers.filter(c => c.in_database !== true).length;
  const matchedCustomers = plan.customers.filter(c => c.in_database === true).length;
  return {
    batch_id: plan.batchId,
    cutoff: plan.cutoff,
    data_rows: plan.totalDataRows,
    blank_rows: plan.blankRows,
    dropoffs_to_add: plan.dropoffs.length,
    dropoffs_skipped: plan.skipped.length,
    skipped_by_reason: skippedBy,
    customers_in_file: plan.customers.length,
    customers_new: plan.hasExisting ? newCustomers : null,
    customers_matched_existing: plan.hasExisting ? matchedCustomers : null,
    dropoffs_by_stage: byStage,
    dropoffs_by_month: Object.fromEntries(Object.entries(byMonth).sort()),
    total_venmo_amount: Math.round(venmo * 100) / 100,
    total_credit_amount: Math.round(credit * 100) / 100,
    open_bags: open,
    flags: plan.flagCounts,
    warnings: plan.warnings,
  };
}

const money = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function formatReport(plan, { verbose = false } = {}) {
  const s = summarize(plan);
  const L = [];
  L.push('Sellers\' Sheet import -- DRY RUN (nothing written)');
  L.push('='.repeat(60));
  L.push(`Batch id:            ${s.batch_id}`);
  L.push(`Cutoff:              rows on/after ${s.cutoff} (${plan.tz})`);
  L.push(`Data rows in CSV:    ${s.data_rows}  (blank: ${s.blank_rows})`);
  if (s.warnings.length) {
    L.push('');
    L.push('WARNINGS');
    s.warnings.forEach(w => L.push('  ! ' + w));
  }
  L.push('');
  L.push('DROP-OFFS');
  L.push(`  to add:            ${s.dropoffs_to_add}`);
  L.push(`  to skip:           ${s.dropoffs_skipped}`);
  for (const [r, n] of Object.entries(s.skipped_by_reason)) L.push(`    - ${r.padEnd(24)} ${n}`);
  if (!plan.hasExisting) {
    L.push('    (database duplicates are not known offline; pass --existing <file> to check,');
    L.push('     the generated SQL also skips rows already in the database)');
  }
  L.push('  by stage:');
  for (const [k, n] of Object.entries(s.dropoffs_by_stage).sort()) L.push(`    - ${k.padEnd(24)} ${n}`);
  L.push('');
  L.push('CUSTOMERS');
  L.push(`  distinct in file:   ${s.customers_in_file}`);
  if (plan.hasExisting) {
    L.push(`  new:                ${s.customers_new}`);
    L.push(`  match existing:     ${s.customers_matched_existing}`);
  }
  L.push('');
  L.push('FLAGS (row still imported unless listed under skip; review these)');
  const flagEntries = Object.entries(s.flags).sort((a, b) => b[1] - a[1]);
  if (!flagEntries.length) L.push('  none');
  for (const [code, n] of flagEntries) {
    const rows = plan.flaggedRows[code] || [];
    const shown = verbose ? rows : rows.slice(0, 12);
    L.push(`  - ${code.padEnd(34)} ${String(n).padStart(4)}   rows ${shown.join(', ')}${rows.length > shown.length ? ', ...' : ''}`);
  }
  L.push('');
  L.push('RECONCILIATION (rows to add)');
  L.push('  drop-offs per month:');
  for (const [m, n] of Object.entries(s.dropoffs_by_month)) L.push(`    ${m}  ${n}`);
  L.push(`  total venmo_amount:  ${money(s.total_venmo_amount)}`);
  L.push(`  total credit_amount: ${money(s.total_credit_amount)}`);
  L.push(`  open bags (not resolved/cancelled): ${s.open_bags}`);
  if (verbose) {
    L.push('');
    L.push('SKIPPED ROWS');
    plan.skipped.forEach(x => L.push(`  row ${x.row}: ${x.reason}`));
  }
  return L.join('\n');
}

module.exports = { summarize, formatReport };
