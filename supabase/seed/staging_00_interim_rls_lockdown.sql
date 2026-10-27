-- ============================================================================
-- STAGING ONLY. Applied 2026-10-26 because 0002/0003 could not be applied to
-- staging yet (apply_migration for 0002 was "cancelled" twice by the approval
-- gate). Without it every staging table had RLS OFF and was readable/writable
-- with the staging anon key. These are the same statements as in 0003, so 0003
-- still applies cleanly afterwards.
-- ============================================================================
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
