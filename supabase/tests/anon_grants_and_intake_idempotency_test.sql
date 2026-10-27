-- Tests for 0005 (anon has no table privileges; admin_password_hash gone) and
-- 0006 (create_intake idempotency). Runs after rls_smoke_test.sql on the
-- LOCAL throwaway database built by run_local.sh; reuses its fixtures.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------------------------------------------------------------- 0005
do $$
declare n int;
begin
  select count(*) into n
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  if n <> 0 then raise exception 'FAIL: anon still holds % table privileges in public', n; end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'settings' and column_name = 'admin_password_hash') then
    raise exception 'FAIL: settings.admin_password_hash still exists';
  end if;
  -- RPC execute grants unchanged
  if not has_function_privilege('anon', 'public.get_shop_public(text)', 'execute')
     or not has_function_privilege('anon', 'public.get_offer_by_token(text)', 'execute')
     or not has_function_privilege('anon', 'public.respond_to_offer(text, text, text, text)', 'execute')
     or not has_function_privilege('anon', 'public.create_intake(text, text, text, text, text, text, boolean, boolean, text)', 'execute') then
    raise exception 'FAIL: anon lost EXECUTE on a public RPC';
  end if;
  if has_function_privilege('anon', 'public.run_sql(text)', 'execute') then
    raise exception 'FAIL: anon can execute run_sql';
  end if;
  -- new tables created later by the migration role do not re-grant anon
  create table public._qc_default_priv_probe (id int);
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_name = '_qc_default_priv_probe';
  drop table public._qc_default_priv_probe;
  if n <> 0 then raise exception 'FAIL: default privileges still grant anon on new tables'; end if;
end $$;

update public.dropoffs set offer_token = 'TESTTOKEN-QC-2', offer_sent_at = now(), customer_responded_at = null,
  stage = 'awaiting_customer', venmo_amount = 5, credit_amount = 7
 where bag_description = 'Second bag';

set role anon;
set request.jwt.claim.sub = '';
do $$
declare n int; a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; ok boolean;
begin
  -- anon cannot touch any table directly
  begin perform 1 from public.customers limit 1; raise exception 'FAIL: anon selected customers';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.dropoffs limit 1; raise exception 'FAIL: anon selected dropoffs';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.settings limit 1; raise exception 'FAIL: anon selected settings';
  exception when insufficient_privilege then null; end;
  begin insert into public.tenants (name) values ('x'); raise exception 'FAIL: anon inserted a tenant';
  exception when insufficient_privilege then null; end;

  -- public RPCs still work as anon
  select count(*) into n from public.get_shop_public('dandelion-kids');
  if n <> 1 then raise exception 'FAIL: get_shop_public as anon'; end if;
  select count(*) into n from public.get_offer_by_token('TESTTOKEN-QC-2');
  if n <> 1 then raise exception 'FAIL: get_offer_by_token as anon'; end if;
  ok := public.respond_to_offer('TESTTOKEN-QC-2', 'credit', 'donate', null);
  if not ok then raise exception 'FAIL: respond_to_offer as anon'; end if;

  -- 0006: old 8-argument call still works (positional)
  a := public.create_intake('dandelion-kids', 'Test Seller 0300', 'seller0300@example.test', '555-010-0300', 'standard', 'QC bag', false, true);
  -- identical double-submit within 2 minutes -> same id
  b := public.create_intake('dandelion-kids', 'Test Seller 0300', 'SELLER0300@example.test ', '555-010-0300', 'standard', 'QC bag', false, true);
  if a is distinct from b then raise exception 'FAIL: identical double-submit created a second drop-off'; end if;
  -- a different bag from the same person is a new drop-off
  c := public.create_intake('dandelion-kids', 'Test Seller 0300', 'seller0300@example.test', '555-010-0300', 'bulk', 'QC second bag', true, true);
  if c = a then raise exception 'FAIL: a different bag was swallowed as a duplicate'; end if;
  -- client key: retry with same key -> same id, even if the payload changed
  d := public.create_intake('dandelion-kids', 'Test Seller 0301', 'seller0301@example.test', null, 'standard', 'Keyed bag', false, true, 'qc-key-0001');
  e := public.create_intake('dandelion-kids', 'Test Seller 0301', 'seller0301@example.test', null, 'standard', 'Keyed bag (edited)', false, true, 'qc-key-0001');
  if d is distinct from e then raise exception 'FAIL: same client key created a second drop-off'; end if;
  -- phone-only seller dedupe
  f := public.create_intake('dandelion-kids', 'Test Seller 0302', null, '555-010-0302', 'standard', null, false, true);
  if f is distinct from public.create_intake('dandelion-kids', 'Test Seller 0302', '', '555-010-0302', 'standard', '', false, true) then
    raise exception 'FAIL: phone-only double-submit created a second drop-off';
  end if;
end $$;
reset role;

do $$
declare n int;
begin
  select count(*) into n from public.dropoffs d join public.customers c on c.id = d.customer_id
   where c.email = 'seller0300@example.test';
  if n <> 2 then raise exception 'FAIL: expected 2 drop-offs for seller0300, got %', n; end if;
  select count(*) into n from public.dropoffs where intake_client_key = 'qc-key-0001';
  if n <> 1 then raise exception 'FAIL: client key stored % times', n; end if;
  select count(*) into n from public.activity_log where action = 'intake_duplicate_ignored';
  if n <> 2 then raise exception 'FAIL: expected 2 intake_duplicate_ignored log rows, got %', n; end if;
  -- outside the 2-minute window an identical submission is a new drop-off
  update public.dropoffs set created_at = now() - interval '3 minutes' where bag_description = 'QC bag';
end $$;

do $$
declare a uuid; b uuid;
begin
  select id into a from public.dropoffs where bag_description = 'QC bag';
  b := public.create_intake('dandelion-kids', 'Test Seller 0300', 'seller0300@example.test', '555-010-0300', 'standard', 'QC bag', false, true);
  if a = b then raise exception 'FAIL: dedupe window is longer than 2 minutes'; end if;
end $$;

-- ---------------------------------------------------------------- staff still reads
set role authenticated;
set request.jwt.claim.sub = '0b5f1a00-0000-4000-8000-000000000003';
do $$
declare n int;
begin
  select count(*) into n from public.dropoffs;
  if n < 6 then raise exception 'FAIL: staff should still read tenant drop-offs, saw %', n; end if;
  select count(*) into n from public.settings;
  if n <> 1 then raise exception 'FAIL: staff should still read own settings'; end if;
  select count(*) into n from public.customers;
  if n < 4 then raise exception 'FAIL: staff should still read customers, saw %', n; end if;
end $$;
reset role;

select '0005/0006 tests passed' as result;
