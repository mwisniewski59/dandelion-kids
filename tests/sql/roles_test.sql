-- ============================================================================
-- Role simulation test for 0007_roles.sql (docs/roles-plan.md matrix).
--
-- STAGING or a LOCAL throwaway database only. Never run on live: the guard
-- below refuses when the database holds >1000 drop-offs.
--
-- Everything runs inside ONE transaction that ends in ROLLBACK, so nothing it
-- creates (fixture customer/drop-offs, fixture logins on a local database)
-- survives. Each role x action attempt runs in its own savepoint (a PL/pgSQL
-- exception block) as `authenticated` with request.jwt.claims.sub = the
-- user's uuid; the attempt is always rolled back to its savepoint, and only
-- its outcome is recorded.
--
-- Outcomes: ALLOWED (exactly one row written), BSTFLOW_ROLE_SELECT /
-- BSTFLOW_ROLE_PRICE (trigger refused with SQLSTATE 42501), or
-- NOROWS / ERROR:<sqlstate>:<message> (always a FAIL).
--
-- Run: psql -v ON_ERROR_STOP=1 -f tests/sql/roles_test.sql
--      (or supabase/tests/run_local.sh, which runs it on a throwaway database)
-- The final SELECTs print one PASS/FAIL line per role x action, then a summary.
--
-- Running through a tool that only returns the LAST statement's rows (the
-- Supabase MCP execute_sql, the SQL Editor): replace the final `rollback;`
-- with the block below. It aborts the transaction (so nothing is kept) and
-- the error text carries the summary plus every failing line:
--   do $$ declare s text; begin
--     select format('ROLES_TEST passed=%s failed=%s total=%s %s',
--       count(*) filter (where expected = got), count(*) filter (where expected <> got), count(*),
--       coalesce(string_agg(role || ' / ' || action || ': expected ' || expected || ' got ' || got, '; ')
--                filter (where expected <> got), ''))
--     into s from _rt;
--     raise exception '%', s;
--   end $$;
-- Fixture logins (same uuids as supabase/seed/staging_01_tenant_and_auth.sql):
--   ...0001 owner  ...0002 manager  ...0003 staff@ (now buyer)
--   ...0005 pricer ...0006 associate ...0007 buyer@
-- ============================================================================
begin;

do $$ begin
  if (select count(*) from public.dropoffs) > 1000 then
    raise exception 'refusing to run: >1000 drop-offs present (live?)';
  end if;
end $$;

-- ---------------------------------------------------------------- fixtures
-- Logins: present on staging (seed); created here (rolled back) on a local db.
insert into auth.users (id, email)
select u.id, u.email from (values
  ('0b5f1a00-0000-4000-8000-000000000001'::uuid, 'owner@example.test'),
  ('0b5f1a00-0000-4000-8000-000000000002'::uuid, 'manager@example.test'),
  ('0b5f1a00-0000-4000-8000-000000000003'::uuid, 'staff@example.test'),
  ('0b5f1a00-0000-4000-8000-000000000005'::uuid, 'pricer@example.test'),
  ('0b5f1a00-0000-4000-8000-000000000006'::uuid, 'associate@example.test'),
  ('0b5f1a00-0000-4000-8000-000000000007'::uuid, 'buyer@example.test')) u(id, email)
where not exists (select 1 from auth.users a where a.id = u.id);

insert into public.memberships (user_id, tenant_id, role) values
  ('0b5f1a00-0000-4000-8000-000000000001', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'owner'),
  ('0b5f1a00-0000-4000-8000-000000000002', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'manager'),
  ('0b5f1a00-0000-4000-8000-000000000003', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'buyer'),
  ('0b5f1a00-0000-4000-8000-000000000005', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'pricer'),
  ('0b5f1a00-0000-4000-8000-000000000006', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'associate'),
  ('0b5f1a00-0000-4000-8000-000000000007', '95ba216b-2f0a-470b-accd-c4b8c08b333e', 'buyer')
on conflict (user_id, tenant_id) do update set role = excluded.role;

-- label = what the report prints; role = the membership role expected.
create temp table _who (label text primary key, role text, uid uuid, ord int) on commit drop;
insert into _who values
  ('owner',             'owner',     '0b5f1a00-0000-4000-8000-000000000001', 1),
  ('manager',           'manager',   '0b5f1a00-0000-4000-8000-000000000002', 2),
  ('buyer (buyer@)',    'buyer',     '0b5f1a00-0000-4000-8000-000000000007', 3),
  ('buyer (ex-staff@)', 'buyer',     '0b5f1a00-0000-4000-8000-000000000003', 4),
  ('pricer',            'pricer',    '0b5f1a00-0000-4000-8000-000000000005', 5),
  ('associate',         'associate', '0b5f1a00-0000-4000-8000-000000000006', 6);

-- Fake customer + one drop-off per starting stage (inserted as the migration
-- role, so the guard trigger does not apply to the fixtures themselves).
create temp table _fx (name text primary key, id uuid) on commit drop;
with c as (
  insert into public.customers (tenant_id, name, email)
  values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', 'Roles Test Seller', 'roles-test@example.test')
  returning id)
insert into _fx select 'customer', id from c;

do $$
declare v record; v_id uuid;
begin
  for v in select * from (values
    ('d_intake',   'intake',            'standard', null::int, null::numeric, '[]'::jsonb, null::text),
    ('d_tagging',  'tagging',           'standard', null,      null,          '[]',        null),
    ('d_pricing',  'pricing',           'standard', 12,        null,          '[{"brand":"Test","type":"Tshirt","size":"Kid","tier":"Good","price":2,"qty":1}]', null),
    ('d_bulk',     'pricing',           'bulk',     null,      null,          '[]',        null),
    ('d_awaiting', 'awaiting_customer', 'standard', 12,        8.00,          '[{"brand":"Test","type":"Tshirt","size":"Kid","tier":"Good","price":2,"qty":4}]', 'ROLES-TEST-TOKEN-1'),
    ('d_resolved', 'resolved',          'standard', 12,        8.00,          '[{"brand":"Test","type":"Tshirt","size":"Kid","tier":"Good","price":2,"qty":4}]', null)
  ) x(name, stage, drop_type, item_count, amt, lines, token) loop
    insert into public.dropoffs (tenant_id, customer_id, drop_type, stage, item_count,
      tagged_at, tagged_by, pricing_lines, venmo_amount, credit_amount, priced_at, priced_by,
      offer_token, offer_sent_at, resolved_at, paid_at)
    values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', (select id from _fx where name = 'customer'),
      v.drop_type, v.stage, v.item_count,
      case when v.stage not in ('intake','tagging') then now() end,
      case when v.stage not in ('intake','tagging') then 'buyer@example.test' end,
      v.lines, v.amt, v.amt * 1.4,
      case when v.amt is not null then now() end,
      case when v.amt is not null then 'buyer@example.test' end,
      v.token, case when v.token is not null then now() end,
      case when v.stage = 'resolved' then now() end,
      case when v.stage = 'resolved' then now() end)
    returning id into v_id;
    insert into _fx values (v.name, v_id);
  end loop;
end $$;

-- ---------------------------------------------------------------- harness
create temp table _rt (n serial, role text, ord int, action text, expected text, got text) on commit drop;

-- Run p_sql as p_role_db (authenticated / anon / service_role) with the given
-- user's JWT claims, inside a savepoint that is always rolled back.
create function pg_temp.attempt(p_uid uuid, p_sql text, p_role_db text default 'authenticated')
returns text language plpgsql as $f$
declare v_state text; v_msg text; v_detail text; n bigint;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', p_role_db)::text, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    perform set_config('role', p_role_db, true);
    execute p_sql;
    get diagnostics n = row_count;
    raise exception using errcode = 'P0001', message = '__ROLLBACK__', detail = n::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  end;
  if v_msg = '__ROLLBACK__' then
    return case when v_detail = '1' then 'ALLOWED' else 'NOROWS(' || v_detail || ')' end;
  elsif v_state = '42501' and v_msg like 'BSTFLOW_ROLE_%' then
    return v_msg;
  end if;
  return 'ERROR:' || v_state || ':' || v_msg;
end $f$;

-- Actions. {id:<fixture>} placeholders are replaced with fixture uuids.
-- guard: S = select-guarded, P = price-guarded, W = walk-in, A = open to all.
create temp table _act (ord int, action text, guard text, sql text) on commit drop;
insert into _act values
 (1,  'select: start tagging (intake->tagging)', 'S',
      $s$update public.dropoffs set stage = 'tagging', tagged_at = null where id = '{id:d_intake}'$s$),
 (2,  'select: finish tagging (item count, tagging->pricing)', 'S',
      $s$update public.dropoffs set stage = 'pricing', tagged_at = now(), tagged_by = 'x@example.test', item_count = 9 where id = '{id:d_tagging}'$s$),
 (3,  'select: skip tagging (intake->pricing)', 'S',
      $s$update public.dropoffs set stage = 'pricing' where id = '{id:d_intake}'$s$),
 (4,  'select: send back to tagging (pricing->tagging)', 'S',
      $s$update public.dropoffs set stage = 'tagging' where id = '{id:d_pricing}'$s$),
 (5,  'price: add pricing line', 'P',
      $s$update public.dropoffs set pricing_lines = pricing_lines || '[{"brand":"Test","type":"Pants","size":"Kid","tier":"Good","price":3,"qty":1}]'::jsonb where id = '{id:d_pricing}'$s$),
 (6,  'price: remove all pricing lines', 'P',
      $s$update public.dropoffs set pricing_lines = '[]'::jsonb where id = '{id:d_pricing}'$s$),
 (7,  'price: finish pricing (amounts, priced_at)', 'P',
      $s$update public.dropoffs set venmo_amount = 2, credit_amount = 2.8, priced_at = now(), priced_by = 'x@example.test' where id = '{id:d_pricing}'$s$),
 (8,  'price: bulk counts + advance', 'P',
      $s$update public.dropoffs set pricing_lines = '[{"brand":"Bulk","type":"Regular items","size":"-","tier":"Bulk","price":0.5,"qty":20}]'::jsonb,
          venmo_amount = 10, credit_amount = 10, item_count = 20, priced_at = now(), priced_by = 'x@example.test',
          stage = 'awaiting_customer' where id = '{id:d_bulk}'$s$),
 (9,  'walk-in insert (resolved, priced)', 'W',
      $s$insert into public.dropoffs (tenant_id, customer_id, drop_type, stage, tagged_at, tagged_by, priced_at, priced_by,
          venmo_amount, credit_amount, pricing_lines, customer_responded_at, payment_choice, leftover_choice, paid_at, resolved_at)
        values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', '{id:customer}', 'standard', 'resolved', now(), 'x@example.test', now(), 'x@example.test',
          5, 7, '[{"brand":"Test","type":"Tshirt","size":"Kid","tier":"Good","price":5,"qty":1}]'::jsonb, now(), 'cash', 'donate', now(), now())$s$),
 (10, 'plain intake insert (no guarded fields)', 'A',
      $s$insert into public.dropoffs (tenant_id, customer_id, drop_type) values ('95ba216b-2f0a-470b-accd-c4b8c08b333e', '{id:customer}', 'standard')$s$),
 (11, 'notes', 'A',
      $s$update public.dropoffs set notes = 'roles test note' where id = '{id:d_awaiting}'$s$),
 (12, 'send offer (pricing->awaiting_customer, offer_sent_at)', 'A',
      $s$update public.dropoffs set stage = 'awaiting_customer', offer_sent_at = now(), offer_token = 'ROLES-TEST-TOKEN-2' where id = '{id:d_pricing}'$s$),
 (13, 'resend offer (offer_sent_at, reminder)', 'A',
      $s$update public.dropoffs set offer_sent_at = now(), reminder_sent_at = now(), reminder_count = reminder_count + 1 where id = '{id:d_awaiting}'$s$),
 (14, 'mark paid (resolved)', 'A',
      $s$update public.dropoffs set paid_at = now(), paid_by = 'x@example.test', stage = 'resolved', resolved_at = now(),
          payment_choice = 'credit', leftover_choice = 'donate', customer_responded_at = now() where id = '{id:d_awaiting}'$s$),
 (15, 'mark paid, leftovers to pick up (awaiting_pickup)', 'A',
      $s$update public.dropoffs set paid_at = now(), paid_by = 'x@example.test', stage = 'awaiting_pickup',
          payment_choice = 'cash', leftover_choice = 'pickup', customer_responded_at = now() where id = '{id:d_awaiting}'$s$),
 (16, 'manual resolution from intake (no amounts)', 'A',
      $s$update public.dropoffs set stage = 'resolved', payment_choice = 'none', leftover_choice = 'pickup',
          customer_responded_at = now(), resolved_at = now(), picked_up_at = now(), picked_up_by = 'x@example.test' where id = '{id:d_intake}'$s$),
 (17, 'reopen (resolved->awaiting_customer)', 'A',
      $s$update public.dropoffs set stage = 'awaiting_customer', resolved_at = null, paid_at = null, picked_up_at = null, picked_up_by = null where id = '{id:d_resolved}'$s$),
 (18, 'delete (soft) and same-value price write', 'A',
      $s$update public.dropoffs set deleted_at = now(), deleted_by = 'x@example.test', venmo_amount = venmo_amount, pricing_lines = pricing_lines where id = '{id:d_awaiting}'$s$),
 (19, 'cancel from tagging', 'A',
      $s$update public.dropoffs set stage = 'cancelled' where id = '{id:d_tagging}'$s$);

-- Substitute fixture ids.
do $$
declare r record;
begin
  for r in select name, id from _fx loop
    update _act set sql = replace(sql, '{id:' || r.name || '}', r.id::text);
  end loop;
end $$;

-- ---------------------------------------------------------------- run matrix
do $$
declare w record; a record; v_exp text;
begin
  for w in select * from _who order by ord loop
    for a in select * from _act order by ord loop
      v_exp := case
        when a.guard in ('S','W') and w.role not in ('owner','manager','buyer') then 'BSTFLOW_ROLE_SELECT'
        when a.guard = 'P' and w.role not in ('owner','manager','buyer','pricer') then 'BSTFLOW_ROLE_PRICE'
        else 'ALLOWED' end;
      insert into _rt (role, ord, action, expected, got)
      values (w.label, w.ord, lpad(a.ord::text, 2, '0') || ' ' || a.action, v_exp,
              pg_temp.attempt(w.uid, a.sql));
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers, legacy, customer flows
do $$
declare w record; v text; v_tok text := 'ROLES-TEST-TOKEN-1'; v_id uuid;
begin
  for w in select * from _who order by ord loop
    perform set_config('request.jwt.claims', json_build_object('sub', w.uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', w.uid::text, true);
    insert into _rt (role, ord, action, expected, got) values
      (w.label, w.ord, '20 can_select()', (w.role in ('owner','manager','buyer'))::text,
         public.can_select('95ba216b-2f0a-470b-accd-c4b8c08b333e')::text),
      (w.label, w.ord, '21 can_price()', (w.role in ('owner','manager','buyer','pricer'))::text,
         public.can_price('95ba216b-2f0a-470b-accd-c4b8c08b333e')::text),
      (w.label, w.ord, '22 get_my_role()', w.role, public.get_my_role());
  end loop;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into _rt (role, ord, action, expected, got)
  select 'db', 10, '30 no legacy staff memberships/invites', '0',
    ((select count(*) from public.memberships where role = 'staff')
     + (select count(*) from public.invites where role = 'staff'))::text;

  -- Customer pages run as anon and call SECURITY DEFINER RPCs.
  insert into _rt (role, ord, action, expected, got) values
   ('anon', 9, '31 create_intake RPC', 'ALLOWED', pg_temp.attempt(null,
     $s$select public.create_intake('dandelion-kids', 'Roles Test Seller', 'roles-test@example.test', null, 'standard', 'roles test bag', false, true)$s$, 'anon')),
   ('anon', 9, '32 get_offer_by_token RPC', 'ALLOWED', pg_temp.attempt(null,
     format($s$select * from public.get_offer_by_token(%L)$s$, v_tok), 'anon')),
   ('anon', 9, '33 respond_to_offer RPC', 'ALLOWED', pg_temp.attempt(null,
     format($s$select 1 where public.respond_to_offer(%L, 'credit', 'donate')$s$, v_tok), 'anon'));

  -- service_role (server-side jobs) is not subject to the guard.
  select id into v_id from _fx where name = 'd_pricing';
  insert into _rt (role, ord, action, expected, got) values
   ('service_role', 8, '34 price write as service_role', 'ALLOWED', pg_temp.attempt(null,
     format($s$update public.dropoffs set venmo_amount = 1 where id = %L$s$, v_id), 'service_role'));
end $$;

-- ---------------------------------------------------------------- report
select role, action, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from _rt order by ord, action;

select count(*) filter (where expected = got)  as passed,
       count(*) filter (where expected <> got) as failed,
       count(*) as total
from _rt;

rollback;
