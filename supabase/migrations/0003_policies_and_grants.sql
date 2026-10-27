-- ============================================================================
-- BST Flow / Dandelion Kids -- 0003 RLS, policies, grants.
-- Mirrors LIVE (acmjbeatbwetjmkibfvm) as of 2026-10-26, i.e. AFTER the security
-- lockdown: the old catch-all "staff all *" / "staff_full_access" policies are
-- gone, workflow tables are scoped to tenant membership, settings/pricing
-- writes need owner/manager, and ls_* tables are read-only to members of the
-- Dandelion Kids tenant (id hard-coded below, as on live).
-- ============================================================================

-- Row level security: enabled on every public table (none FORCEd).
alter table public._migration_report enable row level security;
alter table public.activity_log enable row level security;
alter table public.ai_usage enable row level security;
alter table public.customers enable row level security;
alter table public.dropoffs enable row level security;
alter table public.invites enable row level security;
alter table public.ls_brands enable row level security;
alter table public.ls_inventory_levels enable row level security;
alter table public.ls_outlets enable row level security;
alter table public.ls_payment_types enable row level security;
alter table public.ls_product_categories enable row level security;
alter table public.ls_product_types enable row level security;
alter table public.ls_products enable row level security;
alter table public.ls_registers enable row level security;
alter table public.ls_sale_line_items enable row level security;
alter table public.ls_sale_payments enable row level security;
alter table public.ls_sales enable row level security;
alter table public.ls_sync_state enable row level security;
alter table public.ls_used_sku_catalog enable row level security;
alter table public.ls_users enable row level security;
alter table public.memberships enable row level security;
alter table public.pricing_config enable row level security;
alter table public.settings enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.tenants enable row level security;

-- Policies (all PERMISSIVE, role authenticated). anon has NO policies:
-- anon reaches data only through the SECURITY DEFINER RPCs.
-- _migration_report: RLS on, no policies (fully locked).
create policy "tenant_all_activity" on public.activity_log as permissive for ALL to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids)) with check (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ai_usage_select" on public.ai_usage as permissive for SELECT to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "tenant_all_customers" on public.customers as permissive for ALL to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids)) with check (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "tenant_all_dropoffs" on public.dropoffs as permissive for ALL to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids)) with check (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "invites_manage" on public.invites as permissive for ALL to authenticated using has_role(tenant_id, ARRAY['owner'::text, 'manager'::text]) with check has_role(tenant_id, ARRAY['owner'::text, 'manager'::text]);
create policy "membership_select" on public.memberships as permissive for SELECT to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "pricing_read" on public.pricing_config as permissive for SELECT to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "pricing_write" on public.pricing_config as permissive for ALL to authenticated using has_role(tenant_id, ARRAY['owner'::text, 'manager'::text]) with check has_role(tenant_id, ARRAY['owner'::text, 'manager'::text]);
create policy "settings_read" on public.settings as permissive for SELECT to authenticated using (tenant_id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "settings_write" on public.settings as permissive for ALL to authenticated using has_role(tenant_id, ARRAY['owner'::text, 'manager'::text]) with check has_role(tenant_id, ARRAY['owner'::text, 'manager'::text]);
create policy "staff_profiles_self_read" on public.staff_profiles as permissive for SELECT to authenticated using (id = auth.uid());
create policy "tenant_select" on public.tenants as permissive for SELECT to authenticated using (id IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "tenant_update" on public.tenants as permissive for UPDATE to authenticated using has_role(id, ARRAY['owner'::text]) with check has_role(id, ARRAY['owner'::text]);
create policy "ls_brands_member_read" on public.ls_brands as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_inventory_levels_member_read" on public.ls_inventory_levels as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_outlets_member_read" on public.ls_outlets as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_payment_types_member_read" on public.ls_payment_types as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_product_categories_member_read" on public.ls_product_categories as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_product_types_member_read" on public.ls_product_types as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_products_member_read" on public.ls_products as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_registers_member_read" on public.ls_registers as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_sale_line_items_member_read" on public.ls_sale_line_items as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_sale_payments_member_read" on public.ls_sale_payments as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_sales_member_read" on public.ls_sales as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_sync_state_member_read" on public.ls_sync_state as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_used_sku_catalog_member_read" on public.ls_used_sku_catalog as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));
create policy "ls_users_member_read" on public.ls_users as permissive for SELECT to authenticated using ('95ba216b-2f0a-470b-accd-c4b8c08b333e'::uuid IN ( SELECT auth_tenant_ids() AS auth_tenant_ids));

-- ---------------------------------------------------------------------------
-- Table / view / sequence grants. Start from a clean slate, then grant exactly
-- what live has. Supabase's default privileges would otherwise give anon and
-- authenticated everything on every new object. (MAINTAIN is PG17+; live
-- shows it alongside the others -- it is granted where the server supports it.)
-- ---------------------------------------------------------------------------
revoke all on table public._migration_report from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public._migration_report to authenticated, service_role;
revoke all on table public.activity_log from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.activity_log to anon, authenticated, service_role;
revoke all on table public.ai_usage from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ai_usage to anon, authenticated, service_role;
revoke all on table public.customers from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.customers to anon, authenticated, service_role;
revoke all on table public.dropoffs from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.dropoffs to anon, authenticated, service_role;
revoke all on table public.invites from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.invites to anon, authenticated, service_role;
revoke all on table public.ls_brands from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_brands to anon, authenticated, service_role;
revoke all on table public.ls_inventory_levels from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_inventory_levels to anon, authenticated, service_role;
revoke all on table public.ls_outlets from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_outlets to anon, authenticated, service_role;
revoke all on table public.ls_payment_types from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_payment_types to anon, authenticated, service_role;
revoke all on table public.ls_product_categories from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_product_categories to anon, authenticated, service_role;
revoke all on table public.ls_product_types from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_product_types to anon, authenticated, service_role;
revoke all on table public.ls_products from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_products to anon, authenticated, service_role;
revoke all on table public.ls_registers from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_registers to anon, authenticated, service_role;
revoke all on table public.ls_sale_line_items from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_sale_line_items to anon, authenticated, service_role;
revoke all on table public.ls_sale_payments from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_sale_payments to anon, authenticated, service_role;
revoke all on table public.ls_sales from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_sales to anon, authenticated, service_role;
revoke all on table public.ls_sync_state from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_sync_state to anon, authenticated, service_role;
revoke all on table public.ls_used_sku_catalog from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_used_sku_catalog to authenticated, service_role;
revoke all on table public.ls_users from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_users to anon, authenticated, service_role;
revoke all on table public.memberships from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.memberships to anon, authenticated, service_role;
revoke all on table public.pricing_config from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.pricing_config to anon, authenticated, service_role;
revoke all on table public.settings from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.settings to anon, authenticated, service_role;
revoke all on table public.staff_profiles from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.staff_profiles to authenticated, service_role;
revoke all on table public.tenants from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.tenants to anon, authenticated, service_role;
revoke all on table public.ls_sales_enriched from anon, authenticated;
grant select, references, trigger on table public.ls_sales_enriched to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_sales_enriched to service_role;
revoke all on table public.ls_lines_enriched from anon, authenticated;
grant select, references, trigger on table public.ls_lines_enriched to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.ls_lines_enriched to service_role;
grant select, update, usage on sequence public._migration_report_id_seq to anon, authenticated, service_role;
grant select, update, usage on sequence public.ai_usage_id_seq to anon, authenticated, service_role;
do $$ begin
  -- PG17 MAINTAIN privilege, mirrored from live where available.
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on all tables in schema public to service_role';
    execute 'grant maintain on table public._migration_report, public.activity_log, public.ai_usage, public.customers, public.dropoffs, public.invites, public.ls_brands, public.ls_inventory_levels, public.ls_outlets, public.ls_payment_types, public.ls_product_categories, public.ls_product_types, public.ls_products, public.ls_registers, public.ls_sale_line_items, public.ls_sale_payments, public.ls_sales, public.ls_sync_state, public.ls_used_sku_catalog, public.ls_users, public.memberships, public.pricing_config, public.settings, public.staff_profiles, public.tenants, public.ls_sales_enriched, public.ls_lines_enriched to authenticated';
    execute 'grant maintain on table public.activity_log, public.ai_usage, public.customers, public.dropoffs, public.invites, public.ls_brands, public.ls_inventory_levels, public.ls_outlets, public.ls_payment_types, public.ls_product_categories, public.ls_product_types, public.ls_products, public.ls_registers, public.ls_sale_line_items, public.ls_sale_payments, public.ls_sales, public.ls_sync_state, public.ls_users, public.memberships, public.pricing_config, public.settings, public.tenants to anon';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Function EXECUTE grants (exactly as live).
--   PUBLIC+anon+authenticated : helper/trigger fns and the anon RPCs
--   authenticated only        : signed-in RPCs
--   service_role only         : run_sql, handle_new_auth_user
-- ---------------------------------------------------------------------------
revoke all on function public.accept_invite(text) from public, anon, authenticated;
grant execute on function public.accept_invite(text) to authenticated, service_role;
revoke all on function public.apply_pricing_setup(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_pricing_setup(uuid, jsonb) to authenticated, service_role;
revoke all on function public.auth_tenant_ids() from public, anon, authenticated;
grant execute on function public.auth_tenant_ids() to public, anon, authenticated, service_role;
revoke all on function public.bump_customer_drops() from public, anon, authenticated;
grant execute on function public.bump_customer_drops() to public, anon, authenticated, service_role;
revoke all on function public.bump_staff_profiles_updated_at() from public, anon, authenticated;
grant execute on function public.bump_staff_profiles_updated_at() to public, anon, authenticated, service_role;
revoke all on function public.complete_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.complete_onboarding(uuid) to authenticated, service_role;
revoke all on function public.create_intake(text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_intake(text, text, text, text, text, text, boolean, boolean) to public, anon, authenticated, service_role;
revoke all on function public.create_tenant_for_current_user(text) from public, anon, authenticated;
grant execute on function public.create_tenant_for_current_user(text) to authenticated, service_role;
revoke all on function public.get_my_role() from public, anon, authenticated;
grant execute on function public.get_my_role() to authenticated, service_role;
revoke all on function public.get_offer_by_token(text) from public, anon, authenticated;
grant execute on function public.get_offer_by_token(text) to public, anon, authenticated, service_role;
revoke all on function public.get_shop_public(text) from public, anon, authenticated;
grant execute on function public.get_shop_public(text) to public, anon, authenticated, service_role;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to service_role;
revoke all on function public.has_role(uuid, text[]) from public, anon, authenticated;
grant execute on function public.has_role(uuid, text[]) to public, anon, authenticated, service_role;
revoke all on function public.import_customers(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_customers(uuid, jsonb) to authenticated, service_role;
revoke all on function public.invite_member(uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_member(uuid, text, text) to authenticated, service_role;
revoke all on function public.my_tenants() from public, anon, authenticated;
grant execute on function public.my_tenants() to authenticated, service_role;
revoke all on function public.remove_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated, service_role;
revoke all on function public.respond_to_offer(text, text, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_offer(text, text, text, text) to public, anon, authenticated, service_role;
revoke all on function public.run_sql(text) from public, anon, authenticated;
grant execute on function public.run_sql(text) to service_role;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to public, anon, authenticated, service_role;
