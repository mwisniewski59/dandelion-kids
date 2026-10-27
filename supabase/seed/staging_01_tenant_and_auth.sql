-- ============================================================================
-- STAGING ONLY (qngqrvgcqunywyemzesy). NEVER run against live.
-- Fake tenant + 3 test logins. All data synthetic.
--
-- Test logins (TEST-ONLY password, staging project only):
--   owner@example.test    / TestOnly-BstFlow-2026   role owner
--   manager@example.test  / TestOnly-BstFlow-2026   role manager
--   staff@example.test    / TestOnly-BstFlow-2026   role staff
--
-- The tenant re-uses live's Dandelion tenant UUID on purpose: the ls_* RLS
-- policies (0003) hard-code that UUID, so reusing it lets staging exercise
-- them unchanged. It is an identifier, not personal data.
--
-- pricing_config is NOT in this file: it is the shop's real pricing matrix
-- (the repo is public). It was copied live->staging directly via SQL on
-- 2026-10-26 (md5 of data::text matched live: c63c2da9620511790ca429d315da085c).
-- ============================================================================
do $$

begin
  -- Cheap guard: refuse if this looks like live (live has >1000 dropoffs).
  if (select count(*) from public.dropoffs) > 1000 then
    raise exception 'refusing to seed: this database already holds >1000 drop-offs (live?)';
  end if;
end $$;

insert into public.tenants (id, name, slug, subscription_status, trial_ends_at, onboarded_at)
values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'Dandelion Kids (TEST)', 'dandelion-kids', 'active', null, now())
on conflict (id) do nothing;

-- Values mirror live's settings row (no personal data; admin_password_hash NOT copied).
insert into public.settings (tenant_id, store_name, credit_multiplier, bulk_item_price, bulk_onesie_price,
  reminder_days, auto_donate_days, shoe_condition_excellent, shoe_condition_gently_used,
  shoe_condition_not_great, baby_carrier_divisor, hat_flat_price, cash_pct, credit_pct)
values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'Dandelion Kids (TEST)', 1.60, 0.50, 0.25,
  4, 7, 1.00, 0.75, 0.50, 3.00, 5.00, 0.3, 0.4)
on conflict (tenant_id) do nothing;

-- Test auth users (email/password provider, pre-confirmed).
with u(id, email, display_name) as (values
  ('0b5f1a00-0000-4000-8000-000000000001'::uuid, 'owner@example.test',   'Test Owner'),
  ('0b5f1a00-0000-4000-8000-000000000002'::uuid, 'manager@example.test', 'Test Manager'),
  ('0b5f1a00-0000-4000-8000-000000000003'::uuid, 'staff@example.test',   'Test Staff'))
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('TestOnly-BstFlow-2026', extensions.gen_salt('bf')), now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name), now(), now()
from u
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
from auth.users u
where u.email in ('owner@example.test','manager@example.test','staff@example.test')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- What the on_auth_user_created trigger (0002) would have done.
insert into public.staff_profiles (id, email, display_name, role)
select id, email, raw_user_meta_data->>'display_name', 'associate' from auth.users
where email in ('owner@example.test','manager@example.test','staff@example.test')
on conflict (id) do nothing;

insert into public.memberships (user_id, tenant_id, role) values
  ('0b5f1a00-0000-4000-8000-000000000001', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'owner'),
  ('0b5f1a00-0000-4000-8000-000000000002', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'manager'),
  ('0b5f1a00-0000-4000-8000-000000000003', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'staff')
on conflict (user_id, tenant_id) do nothing;
