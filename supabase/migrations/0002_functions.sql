-- ============================================================================
-- BST Flow / Dandelion Kids -- 0002 functions, views, triggers.
-- Transcribed from pg_get_functiondef / pg_get_viewdef / pg_get_triggerdef on
-- LIVE (acmjbeatbwetjmkibfvm), 2026-10-26. Bodies are verbatim except that
-- CRLF line endings were normalised to LF.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tenant / role helpers (used by RLS policies in 0003)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_tenant_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select tenant_id from public.memberships where user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(p_tenant uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and tenant_id = p_tenant and role = any(p_roles)
  )
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role
  from staff_profiles
  where id = auth.uid()
    and is_active = true
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.my_tenants()
 RETURNS TABLE(tenant_id uuid, name text, slug text, role text, onboarded_at timestamp with time zone, subscription_status text, trial_ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.name, t.slug, m.role, t.onboarded_at, t.subscription_status, t.trial_ends_at
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
  order by t.created_at
$function$
;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_customer_drops()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update customers set total_drops = total_drops + 1 where id = new.customer_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_staff_profiles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into staff_profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'associate'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Tenant lifecycle / membership RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant_for_current_user(p_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_slug text;
  v_base text;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'shop name required'; end if;
  if length(p_name) > 120 then raise exception 'shop name too long'; end if;

  -- Stop one account spawning unlimited shops.
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'shop limit reached for this account';
  end if;

  -- URL-safe slug for public links, made unique.
  v_base := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'shop'; end if;
  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into public.tenants (name, slug) values (trim(p_name), v_slug) returning id into v_tenant;
  insert into public.memberships (user_id, tenant_id, role) values (v_uid, v_tenant, 'owner');

  -- Starter settings so the shop works immediately.
  insert into public.settings (
    tenant_id, store_name, cash_pct, credit_pct, reminder_days, auto_donate_days,
    bulk_item_price, bulk_onesie_price, hat_flat_price, baby_carrier_divisor,
    shoe_condition_excellent, shoe_condition_gently_used, shoe_condition_not_great, business_rules
  ) values (
    v_tenant, trim(p_name), 0.30, 0.50, 7, 14, 0.50, 0.25, 5, 3, 1.0, 0.75, 0.50,
    jsonb_build_object(
      'shoe_types',     jsonb_build_array('Shoes','Boots'),
      'type_behaviors', jsonb_build_object('Hats', jsonb_build_object('kind','flat_price')),
      'brand_rules',    jsonb_build_array()
    )
  );

  insert into public.pricing_config (tenant_id, data) values (
    v_tenant,
    jsonb_build_object(
      'pricingTiers', jsonb_build_array('Basic','Good','Even Better','Very Best'),
      'types',        jsonb_build_array('Tshirt','Long Sleeve','Sweater','Pants','Dress','Shoes','Hats'),
      'sizes',        jsonb_build_array('Baby','Toddler','Kid'),
      'brands',       jsonb_build_object(),
      'pricing',      jsonb_build_object()
    )
  );

  return json_build_object('tenant_id', v_tenant, 'slug', v_slug);
end $function$
;

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_role(p_tenant, array['owner','manager']) then
    raise exception 'not permitted';
  end if;
  update public.tenants set onboarded_at = now() where id = p_tenant;
end $function$
;

CREATE OR REPLACE FUNCTION public.apply_pricing_setup(p_tenant uuid, p_config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_role(p_tenant, array['owner','manager']) then raise exception 'not permitted'; end if;
  if p_config is null then raise exception 'no config supplied'; end if;
  -- Guard against a runaway payload.
  if length(p_config::text) > 500000 then raise exception 'config too large'; end if;

  update public.pricing_config
     set data = p_config, updated_at = now()
   where tenant_id = p_tenant;
  if not found then
    insert into public.pricing_config (tenant_id, data) values (p_tenant, p_config);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.invite_member(p_tenant uuid, p_email text, p_role text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_token text;
begin
  if not has_role(p_tenant, array['owner','manager']) then
    raise exception 'only an owner or manager can invite people';
  end if;
  if p_role not in ('owner','manager','staff') then raise exception 'invalid role'; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv public.invites%rowtype; v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_inv from public.invites
    where token = p_token and accepted_at is null and expires_at > now();
  if v_inv.id is null then raise exception 'invite not found or expired'; end if;

  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'this invite was sent to a different email address';
  end if;

  insert into public.memberships (user_id, tenant_id, role)
    values (v_uid, v_inv.tenant_id, v_inv.role)
    on conflict (user_id, tenant_id) do update set role = excluded.role;
  update public.invites set accepted_at = now() where id = v_inv.id;
  return v_inv.tenant_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.remove_member(p_tenant uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_target_role text; v_owner_count int;
begin
  if not has_role(p_tenant, array['owner','manager']) then raise exception 'not permitted'; end if;

  select role into v_target_role from public.memberships
    where tenant_id = p_tenant and user_id = p_user;
  if v_target_role is null then raise exception 'that person is not in this shop'; end if;

  -- A manager must not be able to remove anyone at or above their level.
  if v_target_role in ('owner','manager') and not has_role(p_tenant, array['owner']) then
    raise exception 'only an owner can remove an owner or manager';
  end if;

  if v_target_role = 'owner' then
    select count(*) into v_owner_count from public.memberships
      where tenant_id = p_tenant and role = 'owner';
    if v_owner_count <= 1 then raise exception 'cannot remove the last owner'; end if;
  end if;

  delete from public.memberships where tenant_id = p_tenant and user_id = p_user;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_member_role(p_tenant uuid, p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_current text; v_owner_count int;
begin
  if p_role not in ('owner','manager','staff') then raise exception 'invalid role'; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.import_customers(p_tenant uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int := 0; v_row jsonb;
begin
  if not has_role(p_tenant, array['owner','manager']) then raise exception 'not permitted'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too many rows in one batch (max 5000)'; end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(v_row->>'name'), '') = '' then continue; end if;
    -- Per-field caps. Without these a single pasted cell containing a
    -- novel's worth of text would be stored verbatim, bloating the shop's
    -- database and every subsequent customer query.
    if length(v_row->>'name') > 200 then raise exception 'a name in this import is too long (max 200 characters)'; end if;
    if length(coalesce(v_row->>'email','')) > 320 then raise exception 'an email in this import is too long'; end if;
    if length(coalesce(v_row->>'phone','')) > 40 then raise exception 'a phone number in this import is too long'; end if;
    if length(coalesce(v_row->>'venmo_handle','')) > 100 then raise exception 'a Venmo handle in this import is too long'; end if;
    -- Skip if this shop already has them (by email, then phone).
    if (v_row->>'email') is not null and exists (
         select 1 from public.customers
         where tenant_id = p_tenant and lower(email) = lower(v_row->>'email')) then
      continue;
    end if;
    insert into public.customers (tenant_id, name, email, phone, venmo_handle)
      values (p_tenant, trim(v_row->>'name'), nullif(trim(coalesce(v_row->>'email','')),''),
              nullif(trim(coalesce(v_row->>'phone','')),''), nullif(trim(coalesce(v_row->>'venmo_handle','')),''));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$
;

-- ---------------------------------------------------------------------------
-- Public (anon) RPCs: intake form and customer offer page
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shop_public(p_slug text)
 RETURNS TABLE(tenant_id uuid, name text, slug text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, coalesce(s.store_name, t.name), t.slug
  from public.tenants t
  left join public.settings s on s.tenant_id = t.id
  where t.slug = p_slug and t.subscription_status <> 'canceled'
$function$
;

CREATE OR REPLACE FUNCTION public.create_intake(p_shop_slug text, p_name text, p_email text, p_phone text, p_drop_type text, p_bag_description text, p_donate_all boolean, p_consented boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_customer_id uuid; v_dropoff_id uuid;
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

  -- Match an existing customer WITHIN THIS SHOP only.
  if p_email is not null and p_email <> '' then
    select id into v_customer_id from public.customers
      where tenant_id = v_tenant and lower(email) = lower(p_email)
      order by created_at desc limit 1;
  end if;
  if v_customer_id is null and p_phone is not null and p_phone <> '' then
    select id into v_customer_id from public.customers
      where tenant_id = v_tenant and phone = p_phone
      order by created_at desc limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (tenant_id, name, email, phone)
      values (v_tenant, trim(p_name), nullif(trim(p_email),''), nullif(trim(p_phone),''))
      returning id into v_customer_id;
  else
    -- Only fill gaps; never overwrite an existing name/phone from a
    -- public form (a stranger must not be able to rewrite someone's record).
    update public.customers
      set phone = coalesce(phone, nullif(trim(p_phone), '')),
          email = coalesce(email, nullif(trim(p_email), ''))
      where id = v_customer_id;
  end if;

  insert into public.dropoffs (tenant_id, customer_id, drop_type, bag_description, donate_all, consented)
    values (v_tenant, v_customer_id, p_drop_type, nullif(trim(p_bag_description),''),
            coalesce(p_donate_all,false), coalesce(p_consented,true))
    returning id into v_dropoff_id;

  insert into public.activity_log (tenant_id, dropoff_id, actor, action)
    values (v_tenant, v_dropoff_id, 'customer', 'intake_submitted');

  return v_dropoff_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_offer_by_token(p_token text)
 RETURNS TABLE(dropoff_id uuid, customer_name text, drop_type text, bag_description text, venmo_amount numeric, credit_amount numeric, donate_all boolean, customer_responded_at timestamp with time zone, payment_choice text, leftover_choice text, store_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.id, c.name, d.drop_type, d.bag_description,
         d.venmo_amount, d.credit_amount, d.donate_all,
         d.customer_responded_at, d.payment_choice, d.leftover_choice,
         coalesce(s.store_name, t.name)
  from public.dropoffs d
  join public.customers c on c.id = d.customer_id
  join public.tenants   t on t.id = d.tenant_id
  left join public.settings s on s.tenant_id = d.tenant_id
  where d.offer_token = p_token and d.offer_sent_at is not null and d.deleted_at is null
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_offer(p_token text, p_payment_choice text, p_leftover_choice text, p_venmo_handle text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dropoff_id uuid; v_customer_id uuid; v_tenant uuid;
begin
  if p_payment_choice not in ('cash','credit') then raise exception 'invalid payment_choice'; end if;
  if p_leftover_choice not in ('pickup','donate') then raise exception 'invalid leftover_choice'; end if;
  -- A cash payout with no Venmo handle leaves the shop unable to pay.
  if p_payment_choice = 'cash' and (p_venmo_handle is null or length(trim(p_venmo_handle)) = 0) then
    raise exception 'A Venmo handle is required for cash payment.';
  end if;

  select id, customer_id, tenant_id into v_dropoff_id, v_customer_id, v_tenant
    from public.dropoffs
    where offer_token = p_token and offer_sent_at is not null
      and customer_responded_at is null and deleted_at is null
    limit 1;
  if v_dropoff_id is null then return false; end if;

  update public.dropoffs set
    payment_choice = p_payment_choice,
    leftover_choice = p_leftover_choice,
    customer_responded_at = now()
  where id = v_dropoff_id;

  if p_venmo_handle is not null and length(trim(p_venmo_handle)) > 0 then
    update public.customers set venmo_handle = trim(p_venmo_handle) where id = v_customer_id;
  end if;

  insert into public.activity_log (tenant_id, dropoff_id, actor, action, details)
    values (v_tenant, v_dropoff_id, 'customer', 'offer_response',
            jsonb_build_object('payment', p_payment_choice, 'leftover', p_leftover_choice));
  return true;
end $function$
;

-- ---------------------------------------------------------------------------
-- Ask-Claude read-only SQL runner. SECURITY INVOKER; EXECUTE granted to
-- service_role only (see 0003).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_sql(query_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  normalized text;
  row_count int;
begin
  if query_text is null or length(trim(query_text)) = 0 then
    return jsonb_build_object('error', 'Empty query');
  end if;

  if length(query_text) > 5000 then
    return jsonb_build_object('error', 'Query too long (max 5000 chars)');
  end if;

  normalized := lower(regexp_replace(query_text, '^\s+|\s+$', '', 'g'));

  if not (normalized like 'select%' or normalized like 'with%') then
    return jsonb_build_object(
      'error', 'Only SELECT queries allowed. Statement must start with SELECT or WITH.'
    );
  end if;

  if normalized ~* '\m(insert|update|delete|truncate|drop|alter|create|grant|revoke|comment|reindex|vacuum|cluster|copy|do|call)\M' then
    return jsonb_build_object(
      'error', 'Query contains forbidden keyword. Read-only SELECT only.'
    );
  end if;

  if normalized ~* '\m(auth|storage|vault|cron|pg_catalog|information_schema|pgsodium|graphql)\.' then
    return jsonb_build_object(
      'error', 'Cross-schema access not allowed. Only the public schema is queryable.'
    );
  end if;

  begin
    set local statement_timeout = '15s';
    set local lock_timeout = '2s';

    -- Use a CTE so the user's query can contain its own LIMIT clause
    -- without colliding with our outer safety LIMIT.
    execute format(
      'with user_q as (%s) select coalesce(jsonb_agg(row_to_json(sub)), ''[]''::jsonb) from (select * from user_q limit 500) sub',
      query_text
    ) into result;

    get diagnostics row_count = row_count;

    return jsonb_build_object(
      'ok', true,
      'rows', result,
      'truncated', row_count >= 500
    );
  exception when others then
    return jsonb_build_object(
      'error', sqlerrm,
      'hint', 'Check column names against ls_sales_enriched and ls_lines_enriched views.'
    );
  end;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so RLS of the caller applies)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ls_sales_enriched WITH (security_invoker=true) AS
 SELECT s.id,
    s.sale_date,
    s.status,
    s.state,
    s.attributes,
    COALESCE(s.used_item_revenue, 0::numeric) + COALESCE(s.new_item_revenue, 0::numeric) AS total_payment,
    s.total_price,
    s.total_tax,
    s.line_item_count,
    s.used_item_count,
    s.new_item_count,
    s.used_item_revenue,
    s.new_item_revenue,
    s.total_margin,
    s.outlet_id,
    o.name AS outlet_name,
    s.register_id,
    r.name AS register_name,
    s.user_id,
    u.display_name AS cashier_name,
    s.customer_id,
    EXTRACT(hour FROM (s.sale_date AT TIME ZONE 'America/New_York'::text)) AS hour_of_day,
    EXTRACT(dow FROM (s.sale_date AT TIME ZONE 'America/New_York'::text)) AS day_of_week,
    date_trunc('day'::text, (s.sale_date AT TIME ZONE 'America/New_York'::text)) AS sale_day,
    date_trunc('week'::text, (s.sale_date AT TIME ZONE 'America/New_York'::text)) AS sale_week,
    date_trunc('month'::text, (s.sale_date AT TIME ZONE 'America/New_York'::text)) AS sale_month
   FROM ls_sales s
     LEFT JOIN ls_outlets o ON o.id = s.outlet_id
     LEFT JOIN ls_registers r ON r.id = s.register_id
     LEFT JOIN ls_users u ON u.id = s.user_id
  WHERE s.deleted_at IS NULL AND s.state = 'closed'::text;

CREATE OR REPLACE VIEW public.ls_lines_enriched WITH (security_invoker=true) AS
 SELECT li.id,
    li.sale_id,
    li.quantity,
    li.price,
    li.cost,
    li.line_total,
    li.discount,
    li.sold_at,
    li.product_id,
    COALESCE(p.name, li.product_name) AS product_name,
    COALESCE(p.sku, li.product_sku) AS product_sku,
    COALESCE(li.brand_id, p.brand_id) AS brand_id,
    b.name AS brand_name,
    COALESCE(li.product_type_id, p.product_type_id) AS product_type_id,
    pt.name AS product_type_name,
    COALESCE(li.category_id, p.category_id) AS category_id,
    pc.name AS category_name,
        CASE
            WHEN uc.sku IS NOT NULL THEN uc.counts_as_used
            WHEN COALESCE(li.cost, 0::numeric) > 0::numeric THEN false
            ELSE true
        END AS is_used,
        CASE
            WHEN uc.sku IS NOT NULL THEN uc.display_type
            WHEN COALESCE(li.cost, 0::numeric) > 0::numeric THEN COALESCE(pt.name, 'Other new'::text)
            ELSE 'Uncategorized'::text
        END AS display_type,
        CASE
            WHEN uc.sku IS NOT NULL THEN uc.category
            WHEN COALESCE(li.cost, 0::numeric) > 0::numeric THEN 'new'::text
            ELSE 'unknown'::text
        END AS item_category,
        CASE
            WHEN li.cost IS NULL OR li.cost = 0::numeric THEN NULL::numeric
            ELSE (li.price - li.cost) * li.quantity
        END AS margin,
    date_trunc('day'::text, (li.sold_at AT TIME ZONE 'America/New_York'::text)) AS sold_day,
    date_trunc('week'::text, (li.sold_at AT TIME ZONE 'America/New_York'::text)) AS sold_week,
    date_trunc('month'::text, (li.sold_at AT TIME ZONE 'America/New_York'::text)) AS sold_month
   FROM ls_sale_line_items li
     LEFT JOIN ls_products p ON p.id = li.product_id
     LEFT JOIN ls_brands b ON b.id = COALESCE(li.brand_id, p.brand_id)
     LEFT JOIN ls_product_types pt ON pt.id = COALESCE(li.product_type_id, p.product_type_id)
     LEFT JOIN ls_product_categories pc ON pc.id = COALESCE(li.category_id, p.category_id)
     LEFT JOIN ls_used_sku_catalog uc ON uc.sku = COALESCE(p.sku, li.product_sku);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER dropoffs_updated_at BEFORE UPDATE ON public.dropoffs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER bump_customer_drops_trg AFTER INSERT ON public.dropoffs FOR EACH ROW EXECUTE FUNCTION public.bump_customer_drops();

CREATE TRIGGER bump_staff_profiles_updated_at BEFORE UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.bump_staff_profiles_updated_at();

-- Every new auth user gets a legacy staff_profiles row.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
