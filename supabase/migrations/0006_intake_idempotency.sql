-- ============================================================================
-- 0006 Make create_intake idempotent against double-submits
--
-- Not yet applied to live or staging.
--
-- 1. New optional 9th parameter p_client_key (default null). The intake page
--    can send one random key per form fill; a retry with the same key returns
--    the drop-off that was already created. Stored in dropoffs.intake_client_key
--    (unique per tenant).
-- 2. Without a key (today's 8-argument call), an identical submission from the
--    same email (or phone, when there is no email) in the same shop within
--    2 minutes returns the existing drop-off id instead of creating a second
--    one. "Identical" = same drop_type and same bag description, so a seller
--    who quickly submits a second, different bag still gets two drop-offs.
-- 3. Concurrent submits for the same person are serialised with a
--    transaction-scoped advisory lock, so two simultaneous taps cannot both
--    pass the check.
--
-- Backwards compatible: PostgREST resolves the existing 8 named-argument call
-- (intake.html) to this function through the parameter default. The old
-- 8-argument function is dropped so the call is not ambiguous.
-- SECURITY DEFINER and search_path are unchanged; EXECUTE is granted to the
-- same API roles as before (anon, authenticated, service_role).
-- ============================================================================

alter table public.dropoffs add column if not exists intake_client_key text;
create unique index if not exists uq_dropoffs_intake_client_key
  on public.dropoffs (tenant_id, intake_client_key) where intake_client_key is not null;

drop function if exists public.create_intake(text, text, text, text, text, text, boolean, boolean);

create or replace function public.create_intake(
  p_shop_slug text, p_name text, p_email text, p_phone text, p_drop_type text,
  p_bag_description text, p_donate_all boolean, p_consented boolean,
  p_client_key text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid; v_customer_id uuid; v_dropoff_id uuid;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_bag   text := nullif(trim(coalesce(p_bag_description, '')), '');
  v_key   text := nullif(trim(coalesce(p_client_key, '')), '');
begin
  select id into v_tenant from public.tenants
    where slug = p_shop_slug and subscription_status <> 'canceled';
  if v_tenant is null then raise exception 'shop not found'; end if;

  if p_drop_type not in ('bulk','standard') then raise exception 'invalid drop_type'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'name required'; end if;
  if length(p_name) > 200 then raise exception 'name too long'; end if;
  if p_email is not null and length(p_email) > 320 then raise exception 'email too long'; end if;
  if p_phone is not null and length(p_phone) > 40 then raise exception 'phone too long'; end if;
  if p_bag_description is not null and length(p_bag_description) > 500 then raise exception 'bag description too long'; end if;
  if v_key is not null and length(v_key) > 100 then raise exception 'client key too long'; end if;

  -- Serialise submits for the same person in this shop (released at commit).
  perform pg_advisory_xact_lock(hashtextextended(
    'create_intake|' || v_tenant::text || '|' || coalesce(v_email, v_phone, lower(trim(p_name))), 0));

  -- 1. Same client key -> the drop-off created by the first attempt.
  if v_key is not null then
    select id into v_dropoff_id from public.dropoffs
      where tenant_id = v_tenant and intake_client_key = v_key;
    if v_dropoff_id is not null then return v_dropoff_id; end if;
  end if;

  -- 2. Identical submission from the same person within 2 minutes.
  select d.id into v_dropoff_id
    from public.dropoffs d join public.customers c on c.id = d.customer_id
   where d.tenant_id = v_tenant
     and d.deleted_at is null
     and d.created_at > now() - interval '2 minutes'
     and d.drop_type = p_drop_type
     and coalesce(d.bag_description, '') = coalesce(v_bag, '')
     and ((v_email is not null and lower(c.email) = v_email)
          or (v_email is null and v_phone is not null and c.phone = v_phone))
   order by d.created_at desc
   limit 1;
  if v_dropoff_id is not null then
    insert into public.activity_log (tenant_id, dropoff_id, actor, action, details)
      values (v_tenant, v_dropoff_id, 'customer', 'intake_duplicate_ignored',
              jsonb_build_object('client_key', v_key));
    return v_dropoff_id;
  end if;

  -- Match an existing customer WITHIN THIS SHOP only.
  if v_email is not null then
    select id into v_customer_id from public.customers
      where tenant_id = v_tenant and lower(email) = v_email
      order by created_at desc limit 1;
  end if;
  if v_customer_id is null and v_phone is not null then
    select id into v_customer_id from public.customers
      where tenant_id = v_tenant and phone = v_phone
      order by created_at desc limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (tenant_id, name, email, phone)
      values (v_tenant, trim(p_name), nullif(trim(p_email),''), v_phone)
      returning id into v_customer_id;
  else
    -- Only fill gaps; never overwrite an existing name/phone from a
    -- public form (a stranger must not be able to rewrite someone's record).
    update public.customers
      set phone = coalesce(phone, v_phone),
          email = coalesce(email, nullif(trim(p_email), ''))
      where id = v_customer_id;
  end if;

  insert into public.dropoffs (tenant_id, customer_id, drop_type, bag_description, donate_all, consented, intake_client_key)
    values (v_tenant, v_customer_id, p_drop_type, v_bag,
            coalesce(p_donate_all,false), coalesce(p_consented,true), v_key)
    returning id into v_dropoff_id;

  insert into public.activity_log (tenant_id, dropoff_id, actor, action)
    values (v_tenant, v_dropoff_id, 'customer', 'intake_submitted');

  return v_dropoff_id;
end $function$;

revoke all on function public.create_intake(text, text, text, text, text, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.create_intake(text, text, text, text, text, text, boolean, boolean, text) to anon, authenticated, service_role;

-- Ask PostgREST to pick up the new signature.
notify pgrst, 'reload schema';
