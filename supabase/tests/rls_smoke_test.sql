-- RLS / RPC smoke test for the BST Flow schema. Runs on the LOCAL throwaway
-- database created by run_local.sh (never on a Supabase project). Every check
-- raises an exception on failure, so psql ON_ERROR_STOP makes the run fail.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------------------------------------------------------------- fixtures
insert into public.tenants (id, name, slug, subscription_status) values
  ('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'Dandelion Kids (TEST)', 'dandelion-kids', 'active'),
  ('00000000-0000-4000-8000-0000000000bb', 'Other Shop (TEST)', 'other-shop', 'active');
insert into auth.users (id, email, raw_user_meta_data) values
  ('0b5f1a00-0000-4000-8000-000000000001', 'owner@example.test',   '{"display_name":"Test Owner"}'),
  ('0b5f1a00-0000-4000-8000-000000000002', 'manager@example.test', '{}'),
  ('0b5f1a00-0000-4000-8000-000000000003', 'staff@example.test',   '{}'),
  ('0b5f1a00-0000-4000-8000-000000000004', 'outsider@example.test','{}');
insert into public.memberships (user_id, tenant_id, role) values
  ('0b5f1a00-0000-4000-8000-000000000001', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'owner'),
  ('0b5f1a00-0000-4000-8000-000000000002', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'manager'),
  ('0b5f1a00-0000-4000-8000-000000000003', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'staff'),
  ('0b5f1a00-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000bb', 'owner');
insert into public.settings (tenant_id, store_name, cash_pct, credit_pct) values
  ('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'Dandelion Kids (TEST)', 0.3, 0.4),
  ('00000000-0000-4000-8000-0000000000bb', 'Other Shop (TEST)', 0.3, 0.5);
insert into public.pricing_config (tenant_id, data) values
  ('95ba216b-2f0a-470b-accd-c4b8c08b333e', '{"pricingTiers":["Good"]}'),
  ('00000000-0000-4000-8000-0000000000bb', '{"pricingTiers":["Good"]}');

do $$ begin
  if (select count(*) from public.staff_profiles) <> 4 then
    raise exception 'FAIL: on_auth_user_created trigger did not create staff_profiles';
  end if;
end $$;

-- ---------------------------------------------------------------- anon
set role anon;
set request.jwt.claim.sub = '';
do $$
declare v uuid; n int;
begin
  select count(*) into n from public.customers;
  if n <> 0 then raise exception 'FAIL: anon can read customers'; end if;
  select count(*) into n from public.get_shop_public('dandelion-kids');
  if n <> 1 then raise exception 'FAIL: get_shop_public'; end if;
  v := public.create_intake('dandelion-kids', 'Test Seller 0001', 'seller0001@example.test', '555-010-0001', 'standard', 'Test bag', true, true);
  v := public.create_intake('dandelion-kids', 'Test Seller 0001', 'SELLER0001@example.test', null, 'bulk', 'Second bag', true, true);
  v := public.create_intake('other-shop', 'Test Seller 0002', 'seller0002@example.test', '555-010-0002', 'standard', null, false, true);
  begin
    perform public.create_intake('no-such-shop', 'x', null, null, 'standard', null, false, true);
    raise exception 'FAIL: create_intake accepted unknown shop';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.run_sql('select 1');
    raise exception 'FAIL: anon can execute run_sql';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  if (select total_drops from public.customers where email = 'seller0001@example.test') <> 2 then
    raise exception 'FAIL: create_intake should reuse the customer (case-insensitive email) and bump total_drops to 2';
  end if;
end $$;

-- offer flow fixture
update public.dropoffs set stage = 'awaiting_customer', offer_sent_at = now(), offer_token = 'TESTTOKEN-RLS-1',
  venmo_amount = 9, credit_amount = 12
 where bag_description = 'Test bag';

set role anon;
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.get_offer_by_token('TESTTOKEN-RLS-1');
  if n <> 1 then raise exception 'FAIL: get_offer_by_token'; end if;
  ok := public.respond_to_offer('TESTTOKEN-RLS-1', 'cash', 'pickup', '@test-seller-0001');
  if not ok then raise exception 'FAIL: respond_to_offer first call'; end if;
  ok := public.respond_to_offer('TESTTOKEN-RLS-1', 'credit', 'donate', null);
  if ok then raise exception 'FAIL: respond_to_offer allowed a second answer'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- staff (tenant A)
set role authenticated;
set request.jwt.claim.sub = '0b5f1a00-0000-4000-8000-000000000003';
do $$
declare n int;
begin
  select count(*) into n from public.dropoffs;
  if n <> 2 then raise exception 'FAIL: staff should see exactly 2 tenant-A drop-offs, saw %', n; end if;
  select count(*) into n from public.customers where tenant_id <> '95ba216b-2f0a-470b-accd-c4b8c08b333e';
  if n <> 0 then raise exception 'FAIL: staff sees other tenant customers'; end if;
  update public.settings set cash_pct = 0.99;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: staff could update settings'; end if;
  select count(*) into n from public.my_tenants();
  if n <> 1 then raise exception 'FAIL: my_tenants'; end if;
  select count(*) into n from public.ls_sales;   -- allowed (member of Dandelion), empty
  begin
    insert into public.ls_sales (id, sale_date) values ('x', now());
    raise exception 'FAIL: staff could write ls_sales';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.invite_member('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'new@example.test', 'staff');
    raise exception 'FAIL: staff could invite';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 0004: awaiting_pickup is a valid stage now
  update public.dropoffs set stage = 'awaiting_pickup', paid_at = now(), picked_up_at = null
   where offer_token = 'TESTTOKEN-RLS-1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: staff could not move a bag to awaiting_pickup'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- manager (tenant A)
set role authenticated;
set request.jwt.claim.sub = '0b5f1a00-0000-4000-8000-000000000002';
do $$
declare n int;
begin
  update public.settings set reminder_days = 5 where tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: manager could not update settings'; end if;
  perform public.invite_member('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'new@example.test', 'staff');
  begin
    perform public.invite_member('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'boss@example.test', 'owner');
    raise exception 'FAIL: manager could invite an owner';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  update public.tenants set name = 'hacked';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: manager could rename tenant (owner only)'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- outsider (tenant B owner)
set role authenticated;
set request.jwt.claim.sub = '0b5f1a00-0000-4000-8000-000000000004';
do $$
declare n int;
begin
  select count(*) into n from public.dropoffs where tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e';
  if n <> 0 then raise exception 'FAIL: other tenant can read Dandelion drop-offs'; end if;
  select count(*) into n from public.dropoffs;
  if n <> 1 then raise exception 'FAIL: outsider should see only own drop-off, saw %', n; end if;
  select count(*) into n from public.ls_sales;
  if n <> 0 then raise exception 'FAIL'; end if;
  begin
    insert into public.dropoffs (tenant_id, customer_id, drop_type)
    values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', gen_random_uuid(), 'standard');
    raise exception 'FAIL: outsider inserted into Dandelion';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'rls smoke test passed' as result;
