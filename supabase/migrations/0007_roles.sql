-- ============================================================================
-- 0007 Buyer / tagger / associate roles (plan: docs/roles-plan.md, Oct 27 2026)
--
-- Roles become: owner, manager, buyer, tagger, associate.
--   * legacy 'staff' memberships and invites are converted to 'buyer'
--   * invite_member / set_member_role accept the five roles (owner/manager
--     only, same rules as before)
--   * get_my_role() reads memberships first (staff_profiles is the fallback)
--   * can_select(tenant) = owner/manager/buyer, can_price(tenant) =
--     owner/manager/buyer/tagger
--   * BEFORE INSERT OR UPDATE trigger on public.dropoffs enforces the
--     Select (Tagging step) and Price (Pricing step) permissions for direct
--     dashboard writes (current_user = 'authenticated'). SECURITY DEFINER RPCs
--     (create_intake, respond_to_offer, ...) run as their owner and are not
--     affected; neither is service_role.
--   * Errors: SQLSTATE 42501, message BSTFLOW_ROLE_SELECT / BSTFLOW_ROLE_PRICE.
--
-- Idempotent: safe to run twice. Runs in one transaction. run_sql untouched.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Role values: staff -> buyer, check constraints allow the five roles.
--    Every invites row is converted (accepted ones too), otherwise the new
--    check constraint could not be added.
-- ---------------------------------------------------------------------------
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.invites     drop constraint if exists invites_role_check;

update public.memberships set role = 'buyer' where role = 'staff';
update public.invites     set role = 'buyer' where role = 'staff';

alter table public.memberships add constraint memberships_role_check
  check (role = any (array['owner'::text, 'manager'::text, 'buyer'::text, 'tagger'::text, 'associate'::text]));
alter table public.invites add constraint invites_role_check
  check (role = any (array['owner'::text, 'manager'::text, 'buyer'::text, 'tagger'::text, 'associate'::text]));

-- ---------------------------------------------------------------------------
-- 2. Permission helpers (reuse has_role).
-- ---------------------------------------------------------------------------
create or replace function public.can_select(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.has_role(p_tenant, array['owner','manager','buyer'])
$function$;

create or replace function public.can_price(p_tenant uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.has_role(p_tenant, array['owner','manager','buyer','tagger'])
$function$;

revoke all on function public.can_select(uuid) from public, anon, authenticated;
revoke all on function public.can_price(uuid)  from public, anon, authenticated;
grant execute on function public.can_select(uuid) to authenticated, service_role;
grant execute on function public.can_price(uuid)  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. get_my_role(): memberships first (earliest shop, as my_tenants orders),
--    then the legacy staff_profiles role.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select m.role
       from public.memberships m
       join public.tenants t on t.id = m.tenant_id
      where m.user_id = auth.uid()
      order by t.created_at, m.created_at
      limit 1),
    (select s.role
       from public.staff_profiles s
      where s.id = auth.uid() and s.is_active = true
      limit 1)
  );
$function$;

-- ---------------------------------------------------------------------------
-- 4. invite_member / set_member_role: same bodies as 0002, five roles.
-- ---------------------------------------------------------------------------
create or replace function public.invite_member(p_tenant uuid, p_email text, p_role text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_token text;
begin
  if not has_role(p_tenant, array['owner','manager']) then
    raise exception 'only an owner or manager can invite people';
  end if;
  if p_role is null or p_role not in ('owner','manager','buyer','tagger','associate') then
    raise exception 'invalid role';
  end if;
  -- Only an OWNER may create another owner. Otherwise a manager could
  -- escalate by proxy: invite a second account as owner, then use it.
  if p_role = 'owner' and not has_role(p_tenant, array['owner']) then
    raise exception 'only an owner can invite another owner';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'valid email required'; end if;

  -- 64 random hex chars, using only built-in gen_random_uuid() so this
  -- needs no extra Postgres extension.
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.invites (tenant_id, email, role, token, invited_by)
    values (p_tenant, lower(trim(p_email)), p_role, v_token, auth.uid());
  return v_token;
end $function$;

create or replace function public.set_member_role(p_tenant uuid, p_user uuid, p_role text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_current text; v_owner_count int;
begin
  if p_role is null or p_role not in ('owner','manager','buyer','tagger','associate') then
    raise exception 'invalid role';
  end if;
  if not has_role(p_tenant, array['owner','manager']) then raise exception 'not permitted'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own role'; end if;

  select role into v_current from public.memberships
    where tenant_id = p_tenant and user_id = p_user;
  if v_current is null then raise exception 'that person is not in this shop'; end if;

  -- Granting OR revoking owner is owner-only.
  if (p_role = 'owner' or v_current = 'owner') and not has_role(p_tenant, array['owner']) then
    raise exception 'only an owner can grant or revoke the owner role';
  end if;
  -- A manager may not promote anyone to manager either (that's owner-level).
  if p_role = 'manager' and not has_role(p_tenant, array['owner']) then
    raise exception 'only an owner can appoint a manager';
  end if;

  if v_current = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.memberships
      where tenant_id = p_tenant and role = 'owner';
    if v_owner_count <= 1 then raise exception 'cannot demote the last owner'; end if;
  end if;

  update public.memberships set role = p_role
    where tenant_id = p_tenant and user_id = p_user;
end $function$;

-- Grants unchanged from 0003 (CREATE OR REPLACE keeps them); restated so a
-- re-run on a database with drifted grants ends in the same state.
revoke all on function public.get_my_role() from public, anon, authenticated;
grant execute on function public.get_my_role() to authenticated, service_role;
revoke all on function public.invite_member(uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_member(uuid, text, text) to authenticated, service_role;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Drop-off guard trigger.
--    SECURITY INVOKER on purpose: current_user must be the caller's role.
--    Inside a SECURITY DEFINER RPC current_user is the function owner
--    (postgres), so customer flows pass straight through.
--
--    Select-guarded (owner/manager/buyer):
--      tagged_at, tagged_by changing; item_count changing (except while the
--      bag is in Pricing: bulk counts are a pricing action); stage entering
--      'tagging'; stage leaving intake/tagging for pricing or
--      awaiting_customer (covers tagging -> pricing and skipping the step).
--    Price-guarded (owner/manager/buyer/tagger):
--      pricing_lines, venmo_amount, credit_amount, priced_at, priced_by
--      changing; item_count changing while in Pricing.
--    INSERT (Walk-In): stage other than intake, or any guarded field set,
--      needs Select.
-- ---------------------------------------------------------------------------
create or replace function public.dropoffs_role_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_need_select boolean := false;
  v_need_price  boolean := false;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_need_select :=
         new.stage is distinct from 'intake'
      or coalesce(new.pricing_lines, '[]'::jsonb) not in ('[]'::jsonb, 'null'::jsonb)
      or new.tagged_at     is not null
      or new.tagged_by     is not null
      or new.item_count    is not null
      or new.venmo_amount  is not null
      or new.credit_amount is not null
      or new.priced_at     is not null
      or new.priced_by     is not null;
  else
    v_need_select :=
         new.tagged_at is distinct from old.tagged_at
      or new.tagged_by is distinct from old.tagged_by
      or (new.item_count is distinct from old.item_count
          and old.stage is distinct from 'pricing')
      or (new.stage = 'tagging' and old.stage is distinct from 'tagging')
      or (new.stage in ('pricing','awaiting_customer')
          and old.stage in ('intake','tagging'));

    v_need_price :=
         new.pricing_lines is distinct from old.pricing_lines
      or new.venmo_amount  is distinct from old.venmo_amount
      or new.credit_amount is distinct from old.credit_amount
      or new.priced_at     is distinct from old.priced_at
      or new.priced_by     is distinct from old.priced_by
      or (new.item_count is distinct from old.item_count
          and old.stage = 'pricing');
  end if;

  if v_need_select and not public.can_select(new.tenant_id) then
    raise exception using errcode = '42501', message = 'BSTFLOW_ROLE_SELECT';
  end if;
  if v_need_price and not public.can_price(new.tenant_id) then
    raise exception using errcode = '42501', message = 'BSTFLOW_ROLE_PRICE';
  end if;
  return new;
end $function$;

-- Trigger functions are not called directly; EXECUTE is only checked when
-- the trigger is created (by the migration role).
revoke all on function public.dropoffs_role_guard() from public, anon, authenticated;
grant execute on function public.dropoffs_role_guard() to service_role;

drop trigger if exists dropoffs_role_guard on public.dropoffs;
create trigger dropoffs_role_guard
  before insert or update on public.dropoffs
  for each row execute function public.dropoffs_role_guard();

commit;

-- Ask PostgREST to pick up the new functions.
notify pgrst, 'reload schema';
