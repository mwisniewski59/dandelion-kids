# BST Flow runbook (one page)

For whoever looks after BST Flow for Dandelion Kids. Items marked **(to confirm)** have not been checked against the live setup.

| | LIVE | STAGING (fake data) |
|---|---|---|
| Supabase project | `acmjbeatbwetjmkibfvm` | `qngqrvgcqunywyemzesy` |
| Used by | `bstflow.com`, `www.bstflow.com` | every other host: Vercel previews, localhost |
| Dandelion Kids tenant id | `95ba216b-2f0a-470b-accd-c4b8c08b333e` (from `supabase/functions/ask_claude`) | (to confirm, staging has its own) |

`config.js` picks the database by hostname, and every page loads it, so previews always use STAGING. `tests/smoke` passes (12/12 on Oct 27).

---

## 1. Add a staff member (by hand)

There is no self-signup for staff. Logins are created in Supabase.

**The five roles** (exact spelling, lower case). The full matrix is in `docs/roles-plan.md`.

| Role | Can do |
|---|---|
| `owner` | Everything, including changing Pricing, Rules and Settings. |
| `manager` | Same as owner. |
| `buyer` | Selects what the shop buys (Start Tagging, Finish Tagging), prices (pricing tool, Finish Pricing), Walk-In, plus everything an associate can do. Pricing, Rules and Settings are view only. |
| `pricer` | Prices only (pricing tool, Finish Pricing), plus everything an associate can do. Can't select clothes or use Walk-In. |
| `associate` | Everything else: send and resend offers, Mark Paid, pickups, donations, Manual Resolution, notes, reopen, customers. Can't select or price. |

The old `staff` role no longer exists. Migration `0007_roles.sql` turns every `staff` login into `buyer`, and the dashboard treats any leftover `staff` as `buyer`. **Run 0007 on LIVE before using the new role names**, or the database will reject them.

1. **Supabase dashboard → (LIVE project) → Authentication → Users → Add user → Create new user.** Enter their email and a temporary password. Tick **Auto Confirm User** so no confirmation email is needed. Give them the temporary password in person.
2. **Give them a role in the shop.** Open **SQL Editor** and run the following. Change the email, and change `'buyer'` to the role you want (`owner`, `manager`, `buyer`, `pricer` or `associate`):

   ```sql
   insert into public.memberships (tenant_id, user_id, role)
   select '95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid, u.id, 'buyer'
   from auth.users u
   where u.email = 'new.person@example.com'
   on conflict (user_id, tenant_id) do update set role = excluded.role;
   ```

   It should say `INSERT 0 1`. `INSERT 0 0` means no login has that email, so check step 1. The app reads roles from `memberships` only; a `staff_profiles` row is created automatically by the sign-up trigger.
3. Have them sign in at `https://bstflow.com/dashboard.html` and change their password with **Forgot your password?** Their role shows next to their email in the sidebar.
   - Without a membership row, a signed-in user sees "This login isn't set up for the shop yet" and a Sign out button.
   - If they press a button their role can't use, it stays greyed out with the reason, for example "Only a buyer, pricer, manager or owner can price clothes." The database refuses the change too.

**Check who has which role:**

```sql
select u.email, m.role
from public.memberships m
join auth.users u on u.id = m.user_id
where m.tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e'
order by m.role, u.email;
```

**Change a role** (for example, make someone a pricer):

```sql
update public.memberships
set role = 'pricer'
where tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e'
  and user_id = (select id from auth.users where email = 'person@example.com');
```

It should say `UPDATE 1`. The person sees the new role the next time they sign in or reload the page. Don't demote the last `owner`.

**Why not `set_member_role`?** `public.set_member_role(p_tenant uuid, p_user uuid, p_role text)` does the same job with safety checks: only an owner or manager can use it, nobody can change their own role, only an owner can appoint a manager or owner, and the last owner can't be demoted. But it checks the *signed-in* user, and the SQL Editor isn't signed in as anyone, so there it stops with "not permitted". Use the plain `update` above in the SQL Editor. `set_member_role` (and `invite_member(p_tenant, p_email, p_role)`) are for calls made from the app by a signed-in owner or manager; after 0007 both accept the five roles.

**Remove someone:** delete their `memberships` row. To block the login entirely, also go to **Authentication → Users → … → Delete user** (or ban the user).

## 2. Reset a password

- **Self-serve (preferred):** on the sign-in screen, click **Forgot your password?** and enter the email. The person gets a reset link that opens `dashboard.html` with a "new password" form. The link expires in about an hour, according to the app's message.
  - The link uses Supabase's built-in email unless custom SMTP is set up. The built-in sender is rate-limited to a few emails per hour. **(To confirm:** whether custom SMTP is configured.**)**
  - The URL `https://www.bstflow.com/dashboard.html` must be on the redirect allow list under **Authentication → URL Configuration → Redirect URLs** **(to confirm)**.
- **From Supabase:** go to **Authentication → Users**, open the user's **…** menu and choose **Send password recovery**. This sends the same email.
- **If email isn't working:** an admin can set a password directly with the Admin API (`auth.admin.updateUserById(id, { password })` using the service-role key). Do this only from a trusted machine and never put the service-role key in the repo.

## 3. Backups and restore (free plan caveats)

- **Free plan: no automatic backups you can restore from.** Supabase backs up Pro, Team and Enterprise projects daily (Pro keeps 7 days). For Free projects, Supabase's advice is to export your own data regularly with the CLI and keep copies somewhere else.
- **Take a backup (weekly, and before any import or migration):**
  ```bash
  supabase login
  supabase link --project-ref acmjbeatbwetjmkibfvm
  supabase db dump -f backup-$(date +%F)-schema.sql
  supabase db dump --data-only -f backup-$(date +%F)-data.sql
  ```
  This needs the database password from **Project Settings → Database**. These files contain customer names, emails and phone numbers, so store them privately and **never commit them to git**.
- **Restore on the Free plan:** load the dump into a project with `psql "<connection string>" -f backup-…-schema.sql`, then the data file. Practise this on **STAGING** first. Restoring over LIVE overwrites everything, including any drop-offs added since the dump.
- **On Pro:** go to **Database → Backups**, pick a backup and confirm. The project is offline while the restore runs. Point-in-time recovery is a paid add-on.
- **Free projects pause after about a week with no activity (to confirm the current policy).** You can restore a paused project from the Supabase dashboard. A paused LIVE project means the drop-off form and the dashboard stop working.
- **Recommendation:** move LIVE to Pro (about $25/month) before turning off the Google Form. That gets you daily backups and no pausing.

## 4. Roll back a website deploy (Vercel)

Vercel deploys `main` to `bstflow.com` automatically.

- **Fastest fix: Instant Rollback.** Go to **Vercel → project → Overview → Production Deployment tile → Instant Rollback**, then **Confirm Rollback**. You can also use **Deployments**, filtered to `main`, then **⋮ → Instant Rollback**. On the **Hobby** plan you can only go back to the deployment *immediately before* the current one. Pro can go back to any earlier production deployment.
- **After a rollback, new pushes to `main` stop going live automatically.** When the fix is merged, click **Undo Rollback** on the production tile, or promote the new deployment, to turn auto-deploy back on.
- **Permanent fix:** `git revert` the bad commit on a branch, open a PR and merge it. Vercel redeploys.
- A rollback only changes the web pages. It does **not** undo database changes, and it does not change Edge Functions such as `send-offer-email`, which are deployed separately in Supabase.

## 5. Where error alerts go

**No error alerting is set up today (to confirm).** Here is what does exist:

- **Staff see errors on screen.** The app shows a red toast such as "Could not send: …" or "Load failed: …". Nothing is reported automatically, so ask staff to screenshot and send it.
- **Vercel** emails the account owner about failed deployments, depending on notification settings **(to confirm the address)**. Runtime logs are under **Vercel → project → Logs**, but this is a static site, so most errors happen in the browser and never reach Vercel.
- **Supabase:** go to **Logs & Analytics** for API, Auth and Postgres logs, and to **Edge Functions → send-offer-email → Logs** for offer-email failures. Usage and quota warnings go to the Supabase org owner's email.
- **Offer emails** go out from `offers@bstflow.com`. Bounces and delivery problems show up with whichever email provider the function uses **(to confirm the provider and who gets its alerts)**.
- **Suggested next step:** pick one inbox, for example the owner's, for Vercel, Supabase and email-provider alerts. Consider adding a free browser error tracker later.
