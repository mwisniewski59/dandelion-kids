# Plan: Buyer / Tagger / Associate roles (Oct 27, 2026)

Supervisor: lead agent (talks to Mark). Developers: Dev A (database), Dev B (dashboard),
Dev C (training + docs). Everyone works on their own branch; the supervisor reviews and merges.

## What Mark asked for
- **Buyer**: selects which clothes the shop buys (the Tagging step) **and** prices them.
- **Tagger**: prices only. Cannot select clothes.
- **General warehouse associate**: neither selecting nor pricing. Everything else.
- **Manager (general manager) and owner**: everything, as today.

## Mark's decisions (Oct 27, 7:40am)
1. "Buying and tagging is the same thing." The app's **Tagging step = the buyer's step**
   (Start Tagging, Finish Tagging, item count). Taggers do the **Pricing step**.
2. Associates can do everything else: send offers, resend, mark paid, pickups and
   donations, customers, manual resolution, notes.
3. Anyone signed in can send offers and mark paid (same as today).
4. The two current staff logins become **buyers**.

## Permission matrix (the contract every developer builds to)

Role names, exactly: `owner`, `manager`, `buyer`, `tagger`, `associate`.
Legacy `staff` is converted to `buyer` by the migration; the dashboard treats any leftover
`staff` as `buyer`, and any unknown role as `associate` (least power).

| Action | owner | manager | buyer | tagger | associate |
|---|---|---|---|---|---|
| See board, bag pages, customers, spreadsheet | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Select**: Start Tagging (intake → tagging), Finish Tagging (item count, tagging → pricing) | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Price**: add / edit / remove pricing lines, bulk counts, Finish Pricing (amounts, priced_at) | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Walk-In** (selects and prices in one go) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Send / resend offer, mark paid, pickup, donate, manual resolution, notes, reopen | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delete (with Undo), export, Insights | ✓ | ✓ | ✓ | ✓ | ✓ (unchanged; owner decision 9 pending) |
| Change Pricing list, Rules, Settings | ✓ | ✓ | view | view | view |
| Add / remove logins | by hand (Mark) |

Manual resolution note: if manual resolution lets someone type cash/credit amounts, that is
pricing. Dev B must check and report; default is to require price permission for the amount
fields only.

## Enforcement (database is the real lock; the screens just explain it)
- Dev A adds a `BEFORE INSERT OR UPDATE` trigger on `public.dropoffs` that runs only when
  `current_user = 'authenticated'` (direct writes from the dashboard). SECURITY DEFINER
  RPCs (customer offer page, intake) are unaffected.
- **Select-guarded changes** (need owner/manager/buyer): `tagged_at`, `tagged_by`,
  `item_count` changing; stage entering `tagging` from anything else; stage going
  `tagging → pricing`.
- **Price-guarded changes** (need owner/manager/buyer/tagger): `pricing_lines`,
  `venmo_amount`, `credit_amount`, `priced_at`, `priced_by` changing.
- **INSERT** of a drop-off that already has a stage past `intake` or non-empty
  `pricing_lines` (Walk-In) needs owner/manager/buyer.
- Error: `raise exception using errcode = '42501', message = 'BSTFLOW_ROLE_SELECT'` or
  `'BSTFLOW_ROLE_PRICE'`. The dashboard maps these to friendly toasts:
  - SELECT: "Only a buyer, manager or owner can select clothes."
  - PRICE: "Only a buyer, tagger, manager or owner can price clothes."
- Role checks reuse `public.has_role(p_tenant uuid, p_roles text[])`.

## Rollout
1. Everything is built and tested against **staging** (`qngqrvgcqunywyemzesy`, fake data).
2. Supervisor reviews, merges to main. Dashboard keeps working on live before the
   migration, because legacy `staff` is treated as `buyer`.
3. Migration `0007_roles.sql` goes to **live** through the Supabase SQL Editor; Mark
   clicks Run, supervisor verifies (role simulations, counts only).
4. Training page, runbook, owner review (doc + PDF) updated to the new roles.

## Developer assignments

### Dev A: database (`devA/roles-db`)
- `supabase/migrations/0007_roles.sql`, idempotent:
  - memberships and invites role check → the five roles; `update memberships set role='buyer' where role='staff'` (same for pending invites).
  - `invite_member` and `set_member_role` accept the five roles (owner/manager-only, as today).
  - `get_my_role()` reads `memberships` first.
  - helper functions `can_select(p_tenant)` and `can_price(p_tenant)` (stable, security definer, search_path set).
  - the dropoffs trigger above.
- Staging: apply 0007; add fake test logins `buyer@`, `tagger@`, `associate@example.test` (same test password as the others) with memberships; update `supabase/seed` files.
- `tests/sql/roles_test.sql`: role simulations in a rolled-back transaction proving each
  matrix row for each role (pass/fail lines). Run it on staging and report results.
- Never write to live. Read-only checks on live are fine (no personal data).

### Dev B: dashboard (`devB/roles-ui`)
- `dashboard.html`: `canSelect()`, `canPrice()`, role normalization (staff→buyer,
  unknown→associate). Gate Start/Finish Tagging, the pricing tool (add/edit/remove lines,
  bulk counts, Finish Pricing), Walk-In, any spreadsheet inline edit or stage dropdown that
  touches guarded fields. Disabled buttons show the reason; don't hide the flow.
- Show the signed-in role next to the email in the sidebar (e.g. "Tagger").
- Map `BSTFLOW_ROLE_*` errors to the toasts above.
- Audit every `sb.from('dropoffs').update/insert` call and list which matrix row it falls under.
- Playwright smoke tests (mocked Supabase) per role: buyer, tagger, associate, manager.

### Dev C: training and docs (`devC/roles-docs`)
- `training.html`: a "Who does what" section with the matrix in plain words.
- `docs/runbook.md`: adding staff with each role, changing a role (SQL using `set_member_role`).
- `docs/owner-review.md`: roles section and decision 11 updated to the five roles.
- Owner review PDF: update the roles page (`/home/claude/work/review-pdf/owner-review.html`,
  re-render with `node render.js`) — not in the repo.

## Definition of done
- Staging role tests all pass; Playwright smoke passes; `node --check` on inline scripts passes.
- No customer data in any output. No emails sent. Live Google Sheet untouched.
- Supervisor merged and Vercel deploy READY; Mark has run 0007 on live and the verification passes.
