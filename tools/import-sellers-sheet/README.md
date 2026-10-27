# Sellers' Sheet import (Form Responses 5 to BST Flow)

This tool moves the drop-offs that are still tracked in the Google Sheet
"Sellers' Sheet 2026", tab **Form Responses 5**, into BST Flow. It brings in
each drop-off and its customer.

- **It works offline.** The tool reads a CSV file on your computer. It writes a
  report and, if you ask, an SQL file. It never connects to the database, to
  Google, or to email.
- **Only new rows come in.** Rows with a Timestamp on or after **2026-05-26**
  are imported. Live already holds Jan 2 to May 25, 2026. You can change the
  date with `--cutoff`.
- **It is safe to run twice.** Re-running the SQL skips rows that are already
  there.
- **No personal data goes to git.** The repo is public, and `.gitignore`
  blocks `*.csv`, `*.sql` and `existing*.json` in this folder. The only CSV
  that is committed is the synthetic sample.

Requirements: Node.js 18 or newer. No `npm install` is needed because the tool
has no dependencies.

## 1. Export the tab to CSV (read-only)

1. Open Sellers' Sheet 2026 and click the **Form Responses 5** tab.
2. Go to **File > Download > Comma-separated values (.csv)**. Google downloads
   only the tab you are on.
3. Save the file outside the repo, for example `~/Downloads/form-responses-5.csv`.

**Do not edit, sort, filter or "clean up" the sheet.** It is the shop's live
sheet. If a cell looks wrong, the tool flags it and keeps the original text in
the drop-off's notes. You fix it in BST Flow afterwards, not in the sheet.

## 2. Dry run

```bash
cd tools/import-sellers-sheet
node import.js --input ~/Downloads/form-responses-5.csv --dry-run
```

The dry run writes nothing. It prints:

- the number of drop-offs to add and to skip, with the reason for each skip
  (`before_cutoff`, `duplicate_in_file`, `timestamp_unparsed`, `no_identity`,
  `already_in_database`)
- drop-offs by stage, and the number of distinct customers
- flags: rows that are imported but need a human look, listed by sheet row number
- a reconciliation summary: drop-offs per month, total `venmo_amount`, total
  `credit_amount`, and the number of open bags

The report shows sheet row numbers only. It never prints names, emails or
phone numbers.

Add `--verbose` to list every flagged and skipped row. Add `--summary-json` to
get the same numbers as JSON.

### Optional: exact add/skip counts against the database

On its own, the dry run cannot see the database, so it cannot tell which rows
are already there. The generated SQL catches those anyway. If you want the
exact counts before importing, export the existing keys. Run this in the
Supabase SQL editor; it only reads:

```sql
select json_build_object(
  'customers', (select json_agg(json_build_object(
      'email', lower(email),
      'phone_digits', right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10)))
    from customers where tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e'),
  'dropoffs', (select json_agg(json_build_object(
      'dropped_at', d.dropped_at,
      'email', lower(c.email),
      'phone_digits', right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10)))
    from dropoffs d join customers c on c.id = d.customer_id
    where d.tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e'));
```

Save the result as `existing.json` in this folder (git ignores it). Then run:

```bash
node import.js --input ~/Downloads/form-responses-5.csv --dry-run --existing existing.json
```

Delete `existing.json` when you are done, because it holds customer emails.

## 3. How the columns are read

| # | Column | Becomes |
|---|--------|---------|
| 1 | Timestamp (the header cell is `/`) | `dropped_at`, read as America/New_York time and DST aware |
| 2 | Policy acknowledgment | `consented` (blank is flagged) |
| 3-5 | Name, Email, Phone | customer. Matched by lowercased email, then by the last 10 digits of the phone. Phones are stored as `(555) 010-0001` |
| 6 | Drop Off Type | `drop_type`: "25 or Less..." is `standard`, "Bulk" is `bulk` |
| 7 | Donate question | `donate_all`: YES is true, NO is false. Bulk drops are always true, which matches live |
| 8 | Bag Description | `bag_description` |
| 9, 10 | T, P | tagged / priced. `x`, `X`, `1`, `done`, `yes` mean yes. `-`, `--`, `na`, `n/a` or blank means no |
| 11 | Email Sent (`10/10`, no year) | `offer_sent_at` at 12:00 shop time. The year is taken from the Timestamp, or the next year if the month/day comes before the drop-off date. A date that would land more than 90 days after the drop-off is treated as a typo: the tool uses the drop-off date, flags the row and keeps the text in notes |
| 12, 13 | Venmo Amount, Store Credit Amount | `venmo_amount`, `credit_amount` |
| 14 | Venmo or Credit | see the payment table below |
| 15 | Pick Up or Donate | see the leftovers table below |
| 16 | notes | `notes`. Any text the tool could not map is added as `[sheet import] ...` |

### Venmo or Credit (column 14)

Only plain, past-tense values count as paid. Anything that is pending,
questioned, split between methods, or paid some other way is **flagged and
never closes the bag**. The original text is kept in the notes.

| Sheet value | payment_choice | Paid? | Flag |
|-------------|----------------|-------|------|
| credited, CREDITED, store credit, credited 6/3 | `credit` | yes | |
| venmoed, Venmoed, venmo, Paid venmo, venmo paid | `cash` | yes | |
| paid | `cash` | yes | `paid_method_assumed_venmo` |
| cash | `cash` | no (open, Ready to Pay) | `cash_not_confirmed_paid` |
| took none, none, n/a | `none` | no | |
| Venmo pending, venmo?, will venmo, credit next visit?, pending, ? | method if named, else empty | no (open) | `payment_pending_or_uncertain` |
| Credited/Venmoed, credit + cash, split ... credit+venmo | empty | no (open) | `payment_split_or_ambiguous` |
| PayPal, check, Zelle, Cash App | empty | no (open) | `payment_other_method` |
| anything else | method if named, else empty | no (open) | `payment_unrecognized` |

### Pick Up or Donate (column 15)

| Sheet value | leftover_choice | Leftovers done? | Flag |
|-------------|-----------------|-----------------|------|
| donated, Donated, donated 5/31 (the date becomes `resolved_at`) | `donate` | yes | |
| picked up, Picked up | `pickup` | yes | |
| took all | `took_all` (the value live already uses) | yes | |
| picking up, Pick up, pickup, will pick up, to pick up | `pickup` | no: **awaiting pickup** | |
| bulk | `bulk` | yes | |
| no leftovers | empty | yes | |
| none, N/A | empty | yes (treated as no leftovers) | `leftover_none_assumed_no_leftovers` |
| donating, donated?, donate, will donate, picked up?, anything with ? or "pending" | `donate` / `pickup` if named | no (open) | `leftover_pending_or_uncertain` |
| anything else | empty | no (open) | `leftover_unrecognized` |

### Stage rules (same as live)

| Sheet state | Stage |
|-------------|-------|
| nothing marked | `intake` |
| T, or T and P, but no email sent | `pricing` |
| Email Sent, no answer | `awaiting_customer` |
| a method is named but not confirmed paid (cash, Venmo pending...) | `awaiting_customer` (shows as Ready to Pay) |
| paid and leftovers waiting (picking up / pick up / will pick up) | `awaiting_pickup` (needs migration 0004) |
| paid, but the leftovers value is uncertain (donating, donated?) | `awaiting_pickup`, flagged `kept_open_for_review` |
| payment flagged for review (pending, split, PayPal, check, unrecognized) | `awaiting_customer`, flagged `kept_open_for_review` |
| paid or took none, and leftovers handled | `resolved` |
| donated or picked up with no payment (auto-donate) | `resolved` |

Every bag that is not `resolved` or `cancelled` counts as an **open bag**.

## 4. The live import (with Mark present)

Run this only with Mark in the room, in this order:

1. **Back up first.** In the Supabase dashboard for the live project, open
   Database > Backups and confirm a backup from today exists, or take one. Also
   record the current counts:
   `select count(*) from customers; select count(*) from dropoffs;`
2. **Apply migration 0004** (`supabase/migrations/0004_awaiting_pickup.sql`) to
   live. It adds the `awaiting_pickup` stage and the `picked_up_at` /
   `picked_up_by` columns. The dashboard already uses these, and the import SQL
   refuses to run without them.
3. Export a fresh CSV (step 1) and run the dry run (step 2). Go through every
   flag with Mark.
4. Generate the scripts:
   ```bash
   node import.js --input ~/Downloads/form-responses-5.csv \
     --out-sql out/import.sql --out-rollback out/rollback.sql
   ```
5. Paste `out/import.sql` into the Supabase SQL editor for live and run it. It
   runs in one transaction and ends with a JSON summary:
   `customers_created`, `customers_matched`, `dropoffs_inserted`,
   `dropoffs_skipped_already_present`, the inserted totals and stages. Check
   these against the dry-run numbers.
6. Reconcile:
   ```sql
   select to_char(dropped_at at time zone 'America/New_York','YYYY-MM') m, count(*),
          sum(venmo_amount), sum(credit_amount)
   from dropoffs where id in (select dropoff_id from activity_log
                              where action = 'imported' and details->>'batch' = '<batch id>')
   group by 1 order by 1;
   ```
7. **If something is wrong**, run `out/rollback.sql`. It deletes only the
   drop-offs from this batch, plus any customer the batch created who has no
   drop-offs left.
8. Delete the CSV, `out/` and `existing.json` from the laptop. They contain
   customer data.

Each imported drop-off gets an `activity_log` row with action `imported`,
actor `import:sellers-sheet`, and `{batch, source, sheet_row}`. Its
`tagged_by`, `priced_by`, `paid_by` and `picked_up_by` fields are set to
`import:sellers-sheet`.

## 5. Development

```bash
npm test                    # node --test (33 tests; 1 is skipped unless IMPORT_TEST_PG is set)
npm run fixture             # regenerate fixtures/form-responses-5.sample.csv (deterministic)
npm run dry-run:sample      # dry run on the synthetic sample
IMPORT_TEST_PG="-h /tmp/pgsock -p 5432 -U postgres" npm test   # adds a real Postgres run: import, re-import, rollback
```

The sample CSV is fully synthetic: Test Seller NNNN, sellerNNNN@example.test
and 555-010-NNNN. It covers every variant listed above, including the messy
ones.
