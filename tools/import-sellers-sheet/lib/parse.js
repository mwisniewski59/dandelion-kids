'use strict';
// Cell-level parsers for the "Form Responses 5" tab of Sellers' Sheet 2026.
// Every parser is pure and returns { value, flag? } so the planner can count
// and report problems without losing the original text.

const SHOP_TZ = 'America/New_York';

// ---------------------------------------------------------------------------
// Time zone helpers (no dependencies; uses Node's built-in ICU via Intl)
// ---------------------------------------------------------------------------
const dtfCache = new Map();
function tzParts(ms, tz) {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, dtf);
  }
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(ms))) p[type] = value;
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: +p.hour === 24 ? 0 : +p.hour, mi: +p.minute, s: +p.second,
  };
}

/** Wall-clock time in `tz` -> UTC ISO string (DST aware). */
function zonedToIso(y, mo, d, h = 0, mi = 0, s = 0, tz = SHOP_TZ) {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wallAsUtc;
  for (let k = 0; k < 3; k++) {
    const p = tzParts(guess, tz);
    const shownAsUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const diff = wallAsUtc - shownAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

/** UTC ISO -> { y, mo, d } in shop time zone. */
function localDate(iso, tz = SHOP_TZ) {
  const p = tzParts(Date.parse(iso), tz);
  return { y: p.y, mo: p.mo, d: p.d };
}

function validYmd(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
const clean = v => (v == null ? '' : String(v).replace(/ /g, ' ').trim());
const BLANKISH = new Set(['', '-', '--', '---', 'na', 'n/a', 'n.a.', 'none', 'null', '?']);
const isBlankish = s => BLANKISH.has(clean(s).toLowerCase());

// ---------------------------------------------------------------------------
// Column parsers
// ---------------------------------------------------------------------------

/** Col 1 Timestamp: "5/27/2026 14:03:11" (Google Forms, shop local time). */
function parseTimestamp(raw, tz = SHOP_TZ) {
  const s = clean(raw);
  if (!s) return { value: null, flag: 'timestamp_missing' };
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  let y, mo, d, h = 0, mi = 0, sec = 0;
  if (m) {
    mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (m[4] != null) {
      h = +m[4]; mi = +m[5]; sec = m[6] ? +m[6] : 0;
      const ap = m[7] && m[7].toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
    }
  } else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] != null) { h = +m[4]; mi = +m[5]; sec = m[6] ? +m[6] : 0; }
  } else {
    return { value: null, flag: 'timestamp_unparsed' };
  }
  if (!validYmd(y, mo, d) || h > 23 || mi > 59 || sec > 59) return { value: null, flag: 'timestamp_unparsed' };
  return { value: zonedToIso(y, mo, d, h, mi, sec, tz), local: { y, mo, d } };
}

/** Col 2 Policy acknowledgment -> consented. */
function parseConsent(raw) {
  const s = clean(raw);
  if (!s) return { value: false, flag: 'consent_blank' };
  return { value: true };
}

/** Col 3 Name */
function parseName(raw) {
  const s = clean(raw).replace(/\s+/g, ' ');
  if (!s) return { value: null, flag: 'name_missing' };
  if (s.length > 200) return { value: s.slice(0, 200), flag: 'name_truncated' };
  return { value: s };
}

/** Col 4 Email -> lowercased, or null. */
function parseEmail(raw) {
  const s = clean(raw).toLowerCase();
  if (isBlankish(s)) return { value: null };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { value: null, flag: 'email_invalid' };
  return { value: s };
}

/** Col 5 Phone -> { value: display, digits } . 10-digit US numbers formatted "(555) 010-0001". */
function parsePhone(raw) {
  const s = clean(raw);
  if (isBlankish(s)) return { value: null, digits: null };
  let digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length === 10) {
    return { value: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, digits };
  }
  if (digits.length >= 7 && digits.length <= 15) return { value: s.slice(0, 40), digits, flag: 'phone_unusual' };
  return { value: null, digits: null, flag: 'phone_invalid' };
}

/** Col 6 Drop Off Type: "25 or Less" | "Bulk" | odd variants. */
function parseDropType(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return { value: 'standard', flag: 'drop_type_blank' };
  if (/^25\b/.test(s) || /25 or less/.test(s)) {
    // "25 or Less- process as 25 or..." and similar are standard.
    return { value: 'standard', flag: s.replace(/\s+/g, ' ') === '25 or less' ? undefined : 'drop_type_variant' };
  }
  if (/bulk/.test(s)) return { value: 'bulk', flag: s === 'bulk' ? undefined : 'drop_type_variant' };
  return { value: 'standard', flag: 'drop_type_unrecognized' };
}

/** Col 7 Donate question -> 'yes' | 'no' | 'bulk' | null */
function parseDonate(raw) {
  const s = clean(raw).toLowerCase();
  if (!s) return { value: null, flag: 'donate_blank' };
  if (/^yes\b/.test(s)) return { value: 'yes' };
  if (/^no\b/.test(s)) return { value: 'no' };
  if (/^not applicable/.test(s) || /bulk/.test(s)) return { value: 'bulk' };
  return { value: null, flag: 'donate_unrecognized' };
}

/** Col 9/10 T / P checkmarks. */
function parseMark(raw) {
  const s = clean(raw).toLowerCase();
  if (['x', 'xx', '✓', '✔', 'y', 'yes', '1', 'done', 'true'].includes(s)) return { value: true };
  if (isBlankish(s)) return { value: false };
  return { value: false, flag: 'mark_unrecognized' };
}

/**
 * Infer a full date for a month/day written without a year, relative to the
 * drop-off date: same year, or the following year if it would fall before the
 * drop-off's month/day (e.g. dropped 12/28, emailed 1/3 -> next year).
 */
function inferYear(mo, d, ref) {
  let y = ref.y;
  if (mo < ref.mo || (mo === ref.mo && d < ref.d)) y += 1;
  return y;
}

/** "10/10", "3/17", "10/10/2026" -> ISO at 12:00 shop time. */
function parseMonthDay(text, refLocal, tz = SHOP_TZ) {
  const m = clean(text).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const mo = +m[1], d = +m[2];
  let y = m[3] ? +m[3] : inferYear(mo, d, refLocal);
  if (y < 100) y += 2000;
  if (!validYmd(y, mo, d)) return null;
  return zonedToIso(y, mo, d, 12, 0, 0, tz);
}

/** Col 11 Email Sent -> { value: iso|null, sent: bool } */
function parseEmailSent(raw, refLocal, tz = SHOP_TZ) {
  const s = clean(raw);
  if (isBlankish(s)) return { value: null, sent: false };
  const iso = parseMonthDay(s, refLocal, tz);
  if (iso) return { value: iso, sent: true };
  return { value: null, sent: true, flag: 'email_sent_unparsed' };
}

/** Col 12/13 currency text -> number (2dp) or null */
function parseAmount(raw) {
  const s = clean(raw);
  if (isBlankish(s)) return { value: null };
  const t = s.replace(/[$,\s]/g, '');
  if (/^\d+(\.\d+)?$/.test(t)) return { value: Math.round(Number(t) * 100) / 100 };
  if (/^\.\d+$/.test(t)) return { value: Math.round(Number('0' + t) * 100) / 100 };
  return { value: null, flag: 'amount_unparsed' };
}

// Text that says something has NOT happened yet, or that someone was unsure.
// Such values never close a bag; they are flagged for review instead.
const UNCERTAIN = /\?|\bpending\b|^will\b|\bwill\s|\bwaiting\b|\btbd\b|\bmaybe\b|\bnot yet\b|\bsoon\b|\bowe[sd]?\b/;
const TRAILING_DATE = String.raw`(?:\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?`;

/**
 * Col 14 Venmo or Credit ->
 *   { choice: 'credit'|'cash'|'none'|null, paid: bool, review?: true, flag? }
 * Only plain, past-tense values count as paid. Anything pending, questioned,
 * split, or paid some other way (PayPal, check...) is flagged and `review`
 * keeps the bag open.
 */
function parsePayment(raw) {
  const s = clean(raw).toLowerCase().replace(/\s+/g, ' ');
  if (s === '' || s === '-' || s === '--') return { choice: null, paid: false };
  if (/^(took none|none|n\/a|na|nothing|no sale|took nothing)$/.test(s)) return { choice: 'none', paid: false };
  const hasCredit = /credit/.test(s) || /\bsc\b/.test(s);
  const hasVenmo = /venmo/.test(s);
  const hasCash = /\bcash\b/.test(s);
  if (/pay\s*pal|\bcheck\b|\bcheque\b|zelle|cash\s*app|apple\s*pay/.test(s)) {
    return { choice: null, paid: false, review: true, flag: 'payment_other_method' };
  }
  if (hasCredit && (hasVenmo || hasCash)) {
    return { choice: null, paid: false, review: true, flag: 'payment_split_or_ambiguous' };
  }
  const method = hasCredit ? 'credit' : (hasVenmo || hasCash || /\bpaid\b/.test(s)) ? 'cash' : null;
  if (UNCERTAIN.test(s)) return { choice: method, paid: false, review: true, flag: 'payment_pending_or_uncertain' };
  if (new RegExp(`^(store )?credit(ed)?${TRAILING_DATE}$`).test(s)) return { choice: 'credit', paid: true };
  if (new RegExp(`^(venmo(ed|'d)?|venmo(ed)? paid|paid (via |by |with )?venmo(ed)?)${TRAILING_DATE}$`).test(s)) {
    return { choice: 'cash', paid: true };
  }
  if (new RegExp(`^paid${TRAILING_DATE}$`).test(s)) return { choice: 'cash', paid: true, flag: 'paid_method_assumed_venmo' };
  if (s === 'cash') return { choice: 'cash', paid: false, flag: 'cash_not_confirmed_paid' };
  return { choice: method, paid: false, review: true, flag: 'payment_unrecognized' };
}

/**
 * Col 15 Pick Up or Donate ->
 *   kind: 'donated' | 'picked_up' | 'took_all' | 'picking_up' | 'bulk' |
 *         'no_leftovers' | 'donate_pending' | 'uncertain' | null
 *   leftover: DB leftover_choice ('donate'|'pickup'|'took_all'|'bulk'|null)
 *   done: true when the bag needs no further action on leftovers
 *   review: true when the value is pending/questioned -> bag stays open
 */
function parseLeftover(raw, refLocal, tz = SHOP_TZ) {
  const s = clean(raw).toLowerCase().replace(/\s+/g, ' ');
  if (s === '' || s === '-' || s === '--') return { kind: null, leftover: null, done: false };
  if (/^(none|n\/a|na|nothing)$/.test(s)) {
    return { kind: 'no_leftovers', leftover: null, done: true, flag: 'leftover_none_assumed_no_leftovers' };
  }
  // Customer will pick up / is picking up: pickup pending (awaiting pickup).
  if (/^((will|to|going to)\s+)?pick\s*-?\s*up$/.test(s) || /^picking\s*-?\s*up\b/.test(s) || s === 'pickup') {
    if (!/\?/.test(s)) return { kind: 'picking_up', leftover: 'pickup', done: false };
  }
  if (UNCERTAIN.test(s) || /^donating\b/.test(s) || /^to donate\b/.test(s) || s === 'donate') {
    const isDonate = /donat/.test(s);
    return {
      kind: isDonate ? 'donate_pending' : 'uncertain',
      leftover: isDonate ? 'donate' : (/pick/.test(s) ? 'pickup' : null),
      done: false, review: true, flag: 'leftover_pending_or_uncertain',
    };
  }
  if (/^donated\b/.test(s)) {
    return { kind: 'donated', leftover: 'donate', done: true, date: parseMonthDay(s, refLocal, tz) };
  }
  if (/^picked\s*-?\s*up/.test(s)) return { kind: 'picked_up', leftover: 'pickup', done: true, date: parseMonthDay(s, refLocal, tz) };
  // Live data uses leftover_choice 'took_all' for "took all" (32 rows Jan-May).
  if (/^took\s*all/.test(s)) return { kind: 'took_all', leftover: 'took_all', done: true };
  if (/^bulk\b/.test(s)) return { kind: 'bulk', leftover: 'bulk', done: true };
  if (/^no\s*left\s*overs?\b/.test(s)) return { kind: 'no_leftovers', leftover: null, done: true };
  return { kind: null, leftover: null, done: false, review: true, flag: 'leftover_unrecognized' };
}

module.exports = {
  SHOP_TZ, zonedToIso, localDate, clean, isBlankish,
  parseTimestamp, parseConsent, parseName, parseEmail, parsePhone, parseDropType,
  parseDonate, parseMark, parseEmailSent, parseAmount, parsePayment, parseLeftover,
  parseMonthDay, inferYear,
};
