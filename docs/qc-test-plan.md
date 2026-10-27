# BST Flow — QC Test Plan (overnight build, Oct 26–27, 2026)

Owner: Lead agent. Executor: QC agent (independent — did not build any of this).
Purpose: independently verify tonight's merged work before Mark and the shop owner see it.
The QC agent **tests and reports only**. It does not fix code, merge, or change any system.

## Ground rules (hard)
1. **Live database** (Supabase project `acmjbeatbwetjmkibfvm`): read-only. Catalog queries,
   aggregate counts, and role simulations inside a transaction that is never committed
   (`begin; set local role …; select …;` — no INSERT/UPDATE/DELETE/DDL). Never select
   personal data (names, emails, phones, Venmo handles, bag descriptions, notes).
2. **Staging database** (`qngqrvgcqunywyemzesy`): fake data only; reads allowed; writes only
   if a test case says so, and only rows the test itself creates.
3. **No email or SMS** to anyone. Never call `send-offer-email`, Resend, or the Gmail flow.
4. **Never touch the Google Sheet** "Sellers' Sheet 2026" (the shop's live sheet).
5. **bstflow.com**: GET requests only (use the Vercel MCP `web_fetch_vercel_url`); never submit
   the intake form or offer page against the live site.
6. Report no customer data. Evidence = counts, file paths, line numbers, HTTP codes.

## Severity
- **Blocker** — data exposure, lost/duplicated drop-offs, customer-facing breakage, emails could send.
- **High** — a core staff or customer step fails.
- **Medium** — wrong behavior with a workaround, or a plan item claimed done but not done.
- **Low** — polish, wording, docs.

## Test cases

### A. Security — live database
| ID | Test | Pass when |
|---|---|---|
| A1 | Simulate a signed-in stranger (random uuid, no membership): count rows in every public table and both `ls_*_enriched` views | All 0 |
| A2 | Simulate `anon`: `has_table_privilege` SELECT on every public table and view | false everywhere, except tables the customer pages truly need (none — they use RPCs) |
| A3 | Simulate each real staff user id from `memberships` (owner + 2 staff): count customers and drop-offs | Each sees the same full counts |
| A4 | Policies on `pricing_config` and `settings`: write policies require owner/manager | No policy with `qual = true`; write policies use `has_role(…,['owner','manager'])` |
| A5 | No policy anywhere with `qual = true` or `with_check = true` | 0 |
| A6 | `get_advisors(security)` on live | No ERROR-level lints; list WARNs |
| A7 | RPC exposure: which SECURITY DEFINER functions `anon` can execute | Only `create_intake`, `get_shop_public`, `get_offer_by_token`, `respond_to_offer`, plus helpers `has_role`/`auth_tenant_ids` (report those) |
| A8 | Edge functions: list them; `ask_claude` source | `ask_claude` is the "turned off" stub (returns 503); report verify_jwt flags |
| A9 | Verify Agent 1's reported risks still hold or not: `settings.admin_password_hash` readable by staff (check column privilege/RLS, do NOT read the value), intake has no rate limit | Report status of each |

### B. Live website (bstflow.com, GET only)
| ID | Test | Pass when |
|---|---|---|
| B1 | `/` | Dandelion Kids staff landing page; no "Start free"/signup links; links to dashboard and /dropoff |
| B2 | `/dropoff` and `/dropoff/` | Serves the intake form (redirect to `/intake.html?shop=dandelion-kids`) |
| B3 | `/signup.html` | Redirect-only page to dashboard |
| B4 | `/config.js` | Uses LIVE only on bstflow.com/www, STAGING otherwise |
| B5 | `/dashboard.html` | Loads `config.js` (no inline Supabase config) |
| B6 | `/assets/dropoff-qr.png`, `/assets/dropoff-sign.html` | 200 |
| B7 | `/docs/runbook.md`, `/docs/owner-review.md`, `/tools/…`, `/supabase/…`, `/tests/…` | 404 (blocked by .vercelignore) |
| B8 | Latest production deployment state | READY; commit = main HEAD |

### C. Code quality (repo main)
| ID | Test | Pass when |
|---|---|---|
| C1 | Extract every inline `<script>` from all HTML pages; `node --check` | All pass |
| C2 | `tests/` smoke suite (`npx playwright test --project=smoke`) | All pass |
| C3 | Secrets scan: service_role keys, `sk_`, `re_` (Resend), `SUPABASE_SERVICE_ROLE`, private keys | None committed (anon keys OK) |
| C4 | Every place DB/user text goes into `innerHTML` in intake.html, offer.html, dashboard.html is escaped | No unescaped interpolation (list any) |
| C5 | No code path on intake/offer/dashboard calls `send-offer-email` without an explicit staff click | Confirm call sites |
| C6 | Role logic in dashboard: staff → Pricing/Rules/Settings read-only; owner/manager editable; unknown role → read-only | Matches by code reading + smoke test |
| C7 | `copyIntakeLink()` includes `?shop=` | Yes |
| C8 | Hard-coded copy vs settings: list every hard-coded percentage/price/day count in customer pages and training | Listed (for the owner review) |

### D. Customer flow (mocked, local)
| ID | Test | Pass when |
|---|---|---|
| D1 | Serve repo locally, mock all `*.supabase.co`; intake with no `?shop=` | Defaults to dandelion-kids, form usable |
| D2 | Intake double-submit | Only one `create_intake` call |
| D3 | Intake network failure on submit | Clear "NOT saved" message, button re-enabled |
| D4 | Offer page: first visit / already answered / bad token / cash without Venmo / network error | Each state shows the right view; cash w/o Venmo blocked client-side |
| D5 | Phone viewports 320px, iPhone, Android | No horizontal overflow on intake and offer |

### E. Staging database
| ID | Test | Pass when |
|---|---|---|
| E1 | Schema parity with live: tables/columns, policies (27), functions (21), views (2) | Match, except staging also has 0004 (awaiting_pickup) |
| E2 | Fake data only | 0 customer emails not ending `@example.test`; phones fake |
| E3 | Stranger simulation on staging | 0 rows everywhere |
| E4 | Test logins exist (owner/manager/staff @example.test) with memberships | 3 users, 3 memberships, correct roles |
| E5 | Advisors on staging | No ERROR lints |

### F. Sellers Sheet importer (`tools/import-sellers-sheet`)
| ID | Test | Pass when |
|---|---|---|
| F1 | `node --test` | All pass (one may skip without local Postgres) |
| F2 | Dry run on the synthetic fixture | Report shows add/skip/flag counts; no contact details in output |
| F3 | Cutoff rule | Rows before 2026-05-26 skipped |
| F4 | Status mapping (T/P "x", Venmo or Credit, Pick Up or Donate variants) | Matches docs/README; list unmapped values |
| F5 | Idempotency | Second run adds 0 (check via the generated SQL's dedupe guard) |
| F6 | Live-run instructions in README | Require backup, Mark present, read-only sheet export |

### G. Docs and plan conformance
| ID | Test | Pass when |
|---|---|---|
| G1 | Spot-check 10 factual claims in `docs/owner-review.md` against code | All accurate (list any wrong) |
| G2 | `docs/runbook.md` steps match the real schema (memberships columns, roles) | Accurate |
| G3 | Each agent brief's overnight tasks: done / partly / not done | Table |
| G4 | Known open items still needing Mark | Listed: 0004 on live, Auth signups off, leaked-password protection, repo private, admin_password_hash cleanup, Supabase plan |

## Report format
1. One-line verdict: **Ready for owner review / Not ready**.
2. Table: ID · Result (Pass/Fail/Blocked/Skipped) · Severity if failed · Evidence (one line).
3. Top issues, most severe first, each with a one-line recommended fix and owner (lead/agent/Mark).
4. Anything that could not be tested and why.
