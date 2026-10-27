'use strict';
// Turns parsed CSV rows into an import plan: customers (deduped) and
// drop-offs (with derived stage), plus per-row flags and skip reasons.

const crypto = require('crypto');
const P = require('./parse');

const EXPECTED_COLUMNS = 16;
const DEFAULT_CUTOFF = '2026-05-26'; // live already holds Jan 2 - May 25, 2026
const ACTOR = 'import:sellers-sheet';

// Loose header checks (header text may vary slightly between exports).
const HEADER_HINTS = [
  null,               // 1 Timestamp (export shows "/")
  /understand|consent|polic/i,
  /name/i,
  /e-?mail/i,
  /phone/i,
  /drop/i,
  /donat/i,
  /bag/i,
  /^\s*t\b|tag/i,
  /^\s*p\b|pric/i,
  /email|sent/i,
  /venmo/i,
  /credit/i,
  /venmo|credit/i,
  /pick|donat/i,
  /note/i,
];

function checkHeader(header) {
  const warnings = [];
  if (header.length < EXPECTED_COLUMNS) {
    warnings.push(`header has ${header.length} columns, expected ${EXPECTED_COLUMNS}`);
  }
  HEADER_HINTS.forEach((re, i) => {
    if (re && header[i] != null && !re.test(header[i])) {
      warnings.push(`column ${i + 1} header "${String(header[i]).slice(0, 40)}" does not look like the expected column`);
    }
  });
  return warnings;
}

function isHeaderRow(row) {
  const first = P.clean(row[0]);
  return first === '/' || /^timestamp$/i.test(first) || (/name/i.test(row[2] || '') && /mail/i.test(row[3] || ''));
}

function cutoffIso(cutoff, tz) {
  const [y, mo, d] = cutoff.split('-').map(Number);
  return P.zonedToIso(y, mo, d, 0, 0, 0, tz);
}

/**
 * Derive the BST Flow stage + lifecycle timestamps for one sheet row.
 * Mirrors live conventions:
 *   intake -> tagging -> pricing -> awaiting_customer -> (awaiting_pickup) -> resolved
 *   - "tagged" puts a bag in 'pricing' (dashboard markTagged does the same)
 *   - priced but not emailed stays in 'pricing' with priced_at set
 *   - offer emailed, no answer -> 'awaiting_customer'
 *   - paid + leftovers handled (donated / picked up / took all / bulk) -> 'resolved'
 *   - paid + "picking up" -> 'awaiting_pickup' (requires migration 0004)
 */
function deriveLifecycle(r) {
  const flags = [];
  const pay = r.payment;            // { choice, paid }
  const left = r.leftover;          // { kind, leftover, done, date }
  const droppedAt = r.droppedAt;
  let tagged = r.tagged;
  let priced = r.priced;
  const hasAmount = r.venmoAmount != null || r.creditAmount != null;
  const offerSent = r.emailSent.sent;
  const responded = pay.choice != null || left.kind != null;

  if (hasAmount && !priced) {
    priced = true;
    if (r.dropType !== 'bulk') flags.push('amount_without_p_mark');   // bulk bags are not T/P marked
  }
  if ((priced || offerSent || responded) && !tagged) tagged = true;      // implied by later steps
  if ((offerSent || pay.choice) && !priced && r.dropType === 'standard') priced = true;

  let stage;
  let paymentChoice = pay.choice;
  let leftoverChoice = left.leftover;
  const isBulk = r.dropType === 'bulk';

  if (pay.paid && left.kind === 'picking_up') {
    stage = 'awaiting_pickup';
  } else if (pay.paid && left.review) {
    stage = 'awaiting_pickup';              // paid; leftovers still to be decided
    flags.push('kept_open_for_review');
  } else if ((pay.paid || pay.choice === 'none') && left.done) {
    stage = 'resolved';
  } else if (pay.paid && left.kind == null) {
    stage = 'resolved';
    if (isBulk) leftoverChoice = 'bulk';
    else if (r.donateAll) leftoverChoice = 'donate';
    else flags.push('paid_no_leftover_decision');
  } else if (pay.choice === 'none' && left.kind === 'picking_up') {
    stage = 'awaiting_pickup';
  } else if (pay.choice === 'none') {
    stage = 'resolved';
    if (r.donateAll || isBulk) leftoverChoice = isBulk ? 'bulk' : 'donate';
    else flags.push('took_none_no_leftover_decision');
  } else if ((pay.choice === 'cash' || pay.choice === 'credit') && !pay.paid) {
    // A payment method is named but not confirmed ("cash", "venmo pending"):
    // leave it open as "Ready to Pay" so staff confirm the payout.
    stage = 'awaiting_customer';
  } else if (left.done) {
    stage = 'resolved';                     // e.g. auto-donated, never answered
  } else if (left.kind === 'picking_up') {
    stage = 'awaiting_customer';
    flags.push('pickup_without_payment_choice');
  } else if (offerSent) {
    stage = 'awaiting_customer';
  } else if (priced) {
    stage = 'pricing';
  } else if (tagged) {
    stage = 'pricing';
  } else {
    stage = 'intake';
  }

  // Pending / questioned / unmapped sheet text must never close a bag.
  // Paid but leftovers uncertain -> awaiting_pickup (staff decide pickup or
  // donate); otherwise -> awaiting_customer.
  let paidOk = pay.paid;
  if ((pay.review || left.review) && (stage === 'resolved' || stage === 'awaiting_pickup')) {
    stage = pay.paid && !pay.review ? 'awaiting_pickup' : 'awaiting_customer';
    if (stage === 'awaiting_customer') paidOk = false;
    flags.push('kept_open_for_review');
  }

  const offerSentAt = offerSent ? (r.emailSent.value || droppedAt) : null;
  const respondedAt = responded && stage !== 'intake' && stage !== 'pricing'
    ? (offerSentAt || droppedAt) : null;
  const paidAt = paidOk ? respondedAt || droppedAt : null;
  const resolvedAt = stage === 'resolved' ? (left.date || paidAt || offerSentAt || droppedAt) : null;
  const pickedUpAt = left.kind === 'picked_up' || left.kind === 'took_all' ? resolvedAt : null;

  return {
    stage, flags,
    tagged_at: tagged ? droppedAt : null,
    priced_at: priced ? droppedAt : null,
    offer_sent_at: offerSentAt,
    customer_responded_at: respondedAt,
    payment_choice: paymentChoice,
    leftover_choice: leftoverChoice,
    paid_at: paidAt,
    resolved_at: resolvedAt,
    picked_up_at: pickedUpAt,
  };
}

function customerKey(email, phoneDigits, name) {
  if (email) return 'email:' + email;
  if (phoneDigits) return 'phone:' + phoneDigits;
  if (name) return 'name:' + name.toLowerCase();
  return null;
}

/**
 * Build the import plan.
 * @param {string[][]} rows   parsed CSV (including header row)
 * @param {object} opts       { cutoff, tz, tenantId, existing }
 *   existing (optional): { dropoffs: [{dropped_at, email, phone_digits}], customers: [{email, phone_digits}] }
 */
function buildPlan(rows, opts = {}) {
  const tz = opts.tz || P.SHOP_TZ;
  const cutoff = opts.cutoff || DEFAULT_CUTOFF;
  const cutIso = cutoffIso(cutoff, tz);
  const warnings = [];

  let dataRows = rows;
  let header = null;
  if (rows.length && isHeaderRow(rows[0])) {
    header = rows[0];
    dataRows = rows.slice(1);
    warnings.push(...checkHeader(header));
  } else {
    warnings.push('no header row detected; assuming first row is data');
  }

  // Existing DB keys (offline idempotency check for the dry run).
  const ex = opts.existing || null;
  const exDrop = new Set();
  const exEmail = new Set();
  const exPhone = new Set();
  if (ex) {
    for (const c of ex.customers || []) {
      if (c.email) exEmail.add(String(c.email).toLowerCase());
      if (c.phone_digits) exPhone.add(String(c.phone_digits).slice(-10));
    }
    for (const d of ex.dropoffs || []) {
      const t = new Date(d.dropped_at).toISOString();
      if (d.email) exDrop.add(t + '|e|' + String(d.email).toLowerCase());
      if (d.phone_digits) exDrop.add(t + '|p|' + String(d.phone_digits).slice(-10));
    }
  }

  const customers = new Map();   // key -> customer
  const dropoffs = [];
  const skipped = [];            // { row, reason }
  const flagCounts = {};
  const flaggedRows = {};        // code -> [row numbers]
  const seenDrop = new Set();
  let blankRows = 0;

  const addFlag = (code, rowNo) => {
    flagCounts[code] = (flagCounts[code] || 0) + 1;
    (flaggedRows[code] = flaggedRows[code] || []).push(rowNo);
  };

  dataRows.forEach((cells, idx) => {
    const rowNo = idx + (header ? 2 : 1);   // spreadsheet row number
    const c = i => (cells[i] == null ? '' : cells[i]);
    if (cells.every(v => P.clean(v) === '')) { blankRows++; return; }
    if (cells.length < EXPECTED_COLUMNS) {
      // Trailing empty cells are sometimes dropped; pad rather than fail.
      while (cells.length < EXPECTED_COLUMNS) cells.push('');
    }

    const ts = P.parseTimestamp(c(0), tz);
    if (!ts.value) { skipped.push({ row: rowNo, reason: ts.flag }); return; }
    if (ts.value < cutIso) { skipped.push({ row: rowNo, reason: 'before_cutoff' }); return; }

    const rowFlags = [];
    const take = r => { if (r.flag) rowFlags.push(r.flag); return r; };

    const consent = take(P.parseConsent(c(1)));
    const name = take(P.parseName(c(2)));
    const email = take(P.parseEmail(c(3)));
    const phone = take(P.parsePhone(c(4)));
    const dropType = take(P.parseDropType(c(5)));
    const donate = take(P.parseDonate(c(6)));
    const bag = P.clean(c(7)).slice(0, 500) || null;
    const T = take(P.parseMark(c(8)));
    const Pm = take(P.parseMark(c(9)));
    let sent = take(P.parseEmailSent(c(10), ts.local, tz));
    // A month/day earlier than the drop-off rolls into next year; if that puts
    // it months away it is a typo -- fall back to the drop-off date and flag.
    if (sent.value && Date.parse(sent.value) - Date.parse(ts.value) > 90 * 864e5) {
      sent = { value: null, sent: true, flag: 'email_sent_far_after_dropoff' };
      rowFlags.push(sent.flag);
    }
    const venmo = take(P.parseAmount(c(11)));
    const credit = take(P.parseAmount(c(12)));
    const pay = take(P.parsePayment(c(13)));
    const left = take(P.parseLeftover(c(14), ts.local, tz));
    if (left.date && Date.parse(left.date) - Date.parse(ts.value) > 120 * 864e5) {
      left.date = null;
      rowFlags.push('leftover_date_far_after_dropoff');
    }
    const notesRaw = P.clean(c(15));

    const key = customerKey(email.value, phone.digits, name.value);
    if (!key) { skipped.push({ row: rowNo, reason: 'no_identity' }); return; }
    if (!email.value) rowFlags.push(phone.digits ? 'no_email_matched_by_phone' : 'no_email_or_phone');

    let donateAll = donate.value === 'yes';
    if (dropType.value === 'bulk') {
      if (donate.value === 'no') rowFlags.push('bulk_but_donate_no');
      donateAll = true;   // live: every bulk drop-off has donate_all = true
    } else if (donate.value === 'bulk') {
      rowFlags.push('donate_says_bulk_but_type_standard');
    }

    const life = deriveLifecycle({
      droppedAt: ts.value,
      dropType: dropType.value,
      donateAll,
      tagged: T.value,
      priced: Pm.value,
      emailSent: sent,
      venmoAmount: venmo.value,
      creditAmount: credit.value,
      payment: pay,
      leftover: left,
    });
    rowFlags.push(...life.flags);
    if (life.offer_sent_at && Date.parse(life.offer_sent_at) < Date.parse(ts.value) - 864e5) {
      rowFlags.push('email_sent_before_dropoff');
    }

    // Keep any sheet text we could not map, so nothing is silently lost.
    const extra = [];
    if (pay.flag) extra.push(`Venmo or Credit: "${P.clean(c(13))}"`);
    if (left.flag) extra.push(`Pick Up or Donate: "${P.clean(c(14))}"`);
    if (sent.flag === 'email_sent_unparsed' || sent.flag === 'email_sent_far_after_dropoff') extra.push(`Email Sent: "${P.clean(c(10))}"`);
    if (venmo.flag) extra.push(`Venmo Amount: "${P.clean(c(11))}"`);
    if (credit.flag) extra.push(`Store Credit Amount: "${P.clean(c(12))}"`);
    let notes = notesRaw || null;
    if (extra.length) notes = [notesRaw, '[sheet import] ' + extra.join('; ')].filter(Boolean).join('\n');

    // In-file duplicate (same submission exported twice / copy-paste rows).
    const dupKey = ts.value + '|' + key;
    if (seenDrop.has(dupKey)) { skipped.push({ row: rowNo, reason: 'duplicate_in_file' }); return; }
    seenDrop.add(dupKey);

    // Already in the database? (only known when --existing is supplied)
    let existsInDb = false;
    if (ex) {
      if (email.value && exDrop.has(ts.value + '|e|' + email.value)) existsInDb = true;
      if (!email.value && phone.digits && exDrop.has(ts.value + '|p|' + phone.digits)) existsInDb = true;
    }
    if (existsInDb) { skipped.push({ row: rowNo, reason: 'already_in_database' }); return; }

    let cust = customers.get(key);
    if (!cust) {
      cust = {
        key,
        name: name.value || (email.value ? email.value.split('@')[0] : 'Unknown seller'),
        email: email.value,
        phone: phone.value,
        phone_digits: phone.digits,
        first_row: rowNo,
        rows: [],
        in_database: ex ? (email.value ? exEmail.has(email.value) : (phone.digits ? exPhone.has(phone.digits) : false)) : null,
      };
      if (!name.value) rowFlags.push('customer_name_fallback');
      customers.set(key, cust);
    } else {
      // Fill gaps only (same rule as create_intake: never overwrite).
      if (!cust.phone && phone.value) { cust.phone = phone.value; cust.phone_digits = phone.digits; }
      if (!cust.email && email.value) cust.email = email.value;
    }
    cust.rows.push(rowNo);

    const uniqFlags = [...new Set(rowFlags)];
    uniqFlags.forEach(f => addFlag(f, rowNo));

    dropoffs.push({
      row_no: rowNo,
      customer_key: key,
      drop_type: dropType.value,
      bag_description: bag,
      donate_all: donateAll,
      consented: consent.value,
      dropped_at: ts.value,
      stage: life.stage,
      tagged_at: life.tagged_at,
      priced_at: life.priced_at,
      venmo_amount: venmo.value,
      credit_amount: credit.value,
      offer_sent_at: life.offer_sent_at,
      customer_responded_at: life.customer_responded_at,
      payment_choice: life.payment_choice,
      leftover_choice: life.leftover_choice,
      resolved_at: life.resolved_at,
      paid_at: life.paid_at,
      picked_up_at: life.picked_up_at,
      notes,
      flags: uniqFlags,
    });
  });

  const batchId = 'sellers-sheet-' + crypto.createHash('sha256')
    .update(JSON.stringify(dropoffs.map(d => [d.row_no, d.dropped_at, d.customer_key])))
    .digest('hex').slice(0, 12);

  return {
    batchId,
    tenantId: opts.tenantId || null,
    cutoff,
    tz,
    header,
    warnings,
    blankRows,
    totalDataRows: dataRows.length,
    customers: [...customers.values()],
    dropoffs,
    skipped,
    flagCounts,
    flaggedRows,
    hasExisting: !!ex,
  };
}

module.exports = { buildPlan, deriveLifecycle, customerKey, checkHeader, isHeaderRow, DEFAULT_CUTOFF, ACTOR, EXPECTED_COLUMNS };
