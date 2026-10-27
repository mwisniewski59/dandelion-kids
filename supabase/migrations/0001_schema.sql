-- ============================================================================
-- BST Flow / Dandelion Kids -- 0001 schema (extensions, sequences, tables,
-- constraints, indexes).
--
-- Generated 2026-10-26 by introspecting the LIVE project (acmjbeatbwetjmkibfvm)
-- catalog only (pg_catalog / information_schema). No data was read or copied.
-- Reproduces live's CURRENT state, including the 2026-10-26 security lockdown.
--
-- Apply order: 0001 -> 0002 -> 0003 (-> 0004, see that file's header).
-- Idempotent where Postgres allows (IF NOT EXISTS); constraints are added
-- unconditionally, so run against an EMPTY database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- Live has: plpgsql, pgcrypto (extensions), uuid-ossp (extensions),
-- pg_stat_statements (extensions), supabase_vault (vault), pg_cron (pg_catalog,
-- zero jobs scheduled), pg_net 0.20.0 (installed in schema PUBLIC on live).
--
-- pg_net in public is flagged by the Supabase security advisor
-- ("extension_in_public"). Nothing in the public schema calls net.*; we install
-- it into the `extensions` schema here instead. pg_cron is NOT installed here:
-- live has no cron jobs. Add it in a later migration if auto-donate/reminder
-- jobs are moved into the database.
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------
create sequence if not exists public._migration_report_id_seq as bigint start 1 increment 1 minvalue 1 maxvalue 9223372036854775807 cache 1;
create sequence if not exists public.ai_usage_id_seq as bigint start 1 increment 1 minvalue 1 maxvalue 9223372036854775807 cache 1;

-- ---------------------------------------------------------------------------
-- Core multi-tenant tables
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text,
  subscription_status text default 'trialing'::text not null,
  trial_ends_at timestamp with time zone default (now() + '30 days'::interval),
  onboarded_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.memberships (
  user_id uuid not null,
  tenant_id uuid not null,
  role text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.invites (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  email text not null,
  role text not null,
  token text not null,
  invited_by uuid,
  accepted_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '14 days'::interval) not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.settings (
  store_name text default 'Dandelion Kids'::text not null,
  credit_multiplier numeric(4,2) default 1.60 not null,
  bulk_item_price numeric(6,2) default 0.50 not null,
  bulk_onesie_price numeric(6,2) default 0.25 not null,
  reminder_days integer default 4 not null,
  auto_donate_days integer default 7 not null,
  updated_at timestamp with time zone default now() not null,
  admin_password_hash text,
  shoe_condition_excellent numeric(4,2) default 1.00 not null,
  shoe_condition_gently_used numeric(4,2) default 0.75 not null,
  shoe_condition_not_great numeric(4,2) default 0.50 not null,
  baby_carrier_divisor numeric(4,2) default 3.00 not null,
  hat_flat_price numeric(6,2) default 5.00 not null,
  business_rules jsonb default '{"shoe_types": ["Shoes", "Sneakers", "Sandals", "Boots", "Water Shoes", "Slippers"], "brand_rules": [{"note": "Crocs and Native are always categorized as Sandals", "brands": ["Crocs", "Native", "Native Shoes"], "force_type": "Sandals"}], "type_behaviors": {"Hats": {"kind": "flat_price", "note": "Uniform flat price regardless of brand or size"}, "Baby Carrier": {"kind": "retail_lookup", "note": "Look up current retail; store price auto-calculated at retail ÷ divisor"}}}'::jsonb not null,
  cash_pct numeric default 0.30 not null,
  credit_pct numeric default 0.50 not null,
  tenant_id uuid not null
);

create table if not exists public.pricing_config (
  data jsonb not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text,
  tenant_id uuid not null
);

-- ---------------------------------------------------------------------------
-- Workflow tables
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text,
  phone text,
  venmo_handle text,
  total_drops integer default 0 not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  tenant_id uuid not null
);

create table if not exists public.dropoffs (
  id uuid default gen_random_uuid() not null,
  customer_id uuid not null,
  drop_type text not null,
  bag_description text,
  donate_all boolean default false not null,
  consented boolean default true not null,
  dropped_at timestamp with time zone default now() not null,
  stage text default 'intake'::text not null,
  tagged_at timestamp with time zone,
  tagged_by text,
  item_count integer,
  priced_at timestamp with time zone,
  priced_by text,
  venmo_amount numeric(10,2),
  credit_amount numeric(10,2),
  pricing_lines jsonb default '[]'::jsonb not null,
  offer_sent_at timestamp with time zone,
  offer_token text,
  reminder_sent_at timestamp with time zone,
  reminder_count integer default 0 not null,
  customer_responded_at timestamp with time zone,
  payment_choice text,
  leftover_choice text,
  resolved_at timestamp with time zone,
  paid_at timestamp with time zone,
  paid_by text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  deleted_by text,
  tenant_id uuid not null
);

create table if not exists public.activity_log (
  id uuid default gen_random_uuid() not null,
  dropoff_id uuid,
  actor text,
  action text not null,
  details jsonb,
  created_at timestamp with time zone default now() not null,
  tenant_id uuid
);

create table if not exists public.ai_usage (
  id bigint default nextval('ai_usage_id_seq'::regclass) not null,
  tenant_id uuid,
  user_id uuid,
  task text not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamp with time zone default now() not null
);

-- Legacy single-shop staff table (pre multi-tenant). Still populated by the
-- on_auth_user_created trigger; RLS lets a user read only their own row.
create table if not exists public.staff_profiles (
  id uuid not null,
  email text not null,
  display_name text,
  role text default 'associate'::text not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Leftover from the multi-tenant migration. RLS on, no policies (locked).
create table if not exists public._migration_report (
  id bigint default nextval('_migration_report_id_seq'::regclass) not null,
  step text,
  detail text,
  at timestamp with time zone default now()
);

-- ---------------------------------------------------------------------------
-- Lightspeed (X-Series) sync mirror tables. Single-shop: not tenant-scoped;
-- RLS policies (0003) hard-code the Dandelion Kids tenant id.
-- ---------------------------------------------------------------------------
create table if not exists public.ls_outlets (
  id text not null,
  name text not null,
  default_tax_id text,
  currency text,
  time_zone text,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_registers (
  id text not null,
  outlet_id text,
  name text not null,
  is_open boolean,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_users (
  id text not null,
  username text,
  display_name text,
  email text,
  account_type text,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_brands (
  id text not null,
  name text not null,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_product_categories (
  id text not null,
  name text not null,
  parent_id text,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_product_types (
  id text not null,
  name text not null,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_payment_types (
  id text not null,
  name text not null,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_products (
  id text not null,
  handle text,
  sku text,
  name text not null,
  description text,
  brand_id text,
  product_type_id text,
  category_id text,
  supplier_id text,
  supply_price numeric(12,2),
  retail_price numeric(12,2),
  has_inventory boolean,
  is_active boolean default true not null,
  is_used_sku boolean generated always as (((supply_price IS NULL) OR (supply_price = (0)::numeric))) stored,
  created_at_ls timestamp with time zone,
  updated_at_ls timestamp with time zone,
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null,
  inventory_level numeric,
  average_cost numeric,
  total_cost numeric,
  reorder_threshold numeric,
  reorder_amount numeric,
  reorder_method text,
  inventory_synced_at timestamp with time zone
);

create table if not exists public.ls_inventory_levels (
  product_id text not null,
  outlet_id text not null,
  inventory_level numeric(12,2),
  reorder_point numeric(12,2),
  reorder_amount numeric(12,2),
  average_cost numeric(12,2),
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_sales (
  id text not null,
  version bigint,
  invoice_number text,
  short_code text,
  status text,
  state text,
  attributes text[],
  outlet_id text,
  register_id text,
  user_id text,
  customer_id text,
  sale_date timestamp with time zone not null,
  created_at_ls timestamp with time zone,
  updated_at_ls timestamp with time zone,
  total_price numeric(12,2),
  total_tax numeric(12,2),
  total_loyalty numeric(12,2),
  total_payment numeric(12,2),
  line_item_count integer default 0 not null,
  used_item_count integer default 0 not null,
  new_item_count integer default 0 not null,
  used_item_revenue numeric(12,2) default 0 not null,
  new_item_revenue numeric(12,2) default 0 not null,
  total_margin numeric(12,2),
  deleted_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_sale_line_items (
  id text not null,
  sale_id text not null,
  product_id text,
  quantity numeric(12,3) not null,
  price numeric(12,2) not null,
  cost numeric(12,2),
  discount numeric(12,2) default 0 not null,
  tax_amount numeric(12,2) default 0 not null,
  loyalty_amount numeric(12,2) default 0 not null,
  line_total numeric(12,2) not null,
  status text,
  is_used boolean generated always as (((cost IS NULL) OR (cost = (0)::numeric))) stored,
  product_name text,
  product_sku text,
  brand_id text,
  product_type_id text,
  category_id text,
  sold_at timestamp with time zone not null,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_sale_payments (
  id text not null,
  sale_id text not null,
  payment_type_id text,
  amount numeric(12,2) not null,
  payment_date timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.ls_sync_state (
  id integer default 1 not null,
  last_sale_version bigint default 0 not null,
  last_full_product_sync_at timestamp with time zone,
  last_reference_sync_at timestamp with time zone,
  last_sync_at timestamp with time zone,
  last_sync_status text,
  last_sync_error text,
  total_sales_synced bigint default 0 not null,
  sync_in_progress boolean default false not null,
  sync_started_at timestamp with time zone
);

create table if not exists public.ls_used_sku_catalog (
  sku text not null,
  product_name text not null,
  category text not null,
  display_type text not null,
  counts_as_used boolean default true not null,
  updated_at timestamp with time zone default now() not null
);

-- ---------------------------------------------------------------------------
-- Sequence ownership
-- ---------------------------------------------------------------------------
alter sequence public.ai_usage_id_seq owned by public.ai_usage.id;
alter sequence public._migration_report_id_seq owned by public._migration_report.id;

-- ---------------------------------------------------------------------------
-- Primary keys
-- ---------------------------------------------------------------------------
alter table public._migration_report add constraint _migration_report_pkey PRIMARY KEY (id);
alter table public.activity_log add constraint activity_log_pkey PRIMARY KEY (id);
alter table public.ai_usage add constraint ai_usage_pkey PRIMARY KEY (id);
alter table public.customers add constraint customers_pkey PRIMARY KEY (id);
alter table public.dropoffs add constraint dropoffs_pkey PRIMARY KEY (id);
alter table public.invites add constraint invites_pkey PRIMARY KEY (id);
alter table public.ls_brands add constraint ls_brands_pkey PRIMARY KEY (id);
alter table public.ls_inventory_levels add constraint ls_inventory_levels_pkey PRIMARY KEY (product_id, outlet_id);
alter table public.ls_outlets add constraint ls_outlets_pkey PRIMARY KEY (id);
alter table public.ls_payment_types add constraint ls_payment_types_pkey PRIMARY KEY (id);
alter table public.ls_product_categories add constraint ls_product_categories_pkey PRIMARY KEY (id);
alter table public.ls_product_types add constraint ls_product_types_pkey PRIMARY KEY (id);
alter table public.ls_products add constraint ls_products_pkey PRIMARY KEY (id);
alter table public.ls_registers add constraint ls_registers_pkey PRIMARY KEY (id);
alter table public.ls_sale_line_items add constraint ls_sale_line_items_pkey PRIMARY KEY (id);
alter table public.ls_sale_payments add constraint ls_sale_payments_pkey PRIMARY KEY (id);
alter table public.ls_sales add constraint ls_sales_pkey PRIMARY KEY (id);
alter table public.ls_sync_state add constraint ls_sync_state_pkey PRIMARY KEY (id);
alter table public.ls_used_sku_catalog add constraint ls_used_sku_catalog_pkey PRIMARY KEY (sku);
alter table public.ls_users add constraint ls_users_pkey PRIMARY KEY (id);
alter table public.memberships add constraint memberships_pkey PRIMARY KEY (user_id, tenant_id);
alter table public.pricing_config add constraint pricing_config_pkey PRIMARY KEY (tenant_id);
alter table public.settings add constraint settings_pkey PRIMARY KEY (tenant_id);
alter table public.staff_profiles add constraint staff_profiles_pkey PRIMARY KEY (id);
alter table public.tenants add constraint tenants_pkey PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- Unique constraints
-- ---------------------------------------------------------------------------
alter table public.dropoffs add constraint dropoffs_offer_token_key UNIQUE (offer_token);
alter table public.invites add constraint invites_token_key UNIQUE (token);
alter table public.tenants add constraint tenants_slug_key UNIQUE (slug);

-- ---------------------------------------------------------------------------
-- Check constraints
-- ---------------------------------------------------------------------------
alter table public.dropoffs add constraint dropoffs_drop_type_check CHECK ((drop_type = ANY (ARRAY['bulk'::text, 'standard'::text])));
alter table public.dropoffs add constraint dropoffs_leftover_choice_check CHECK ((leftover_choice = ANY (ARRAY['pickup'::text, 'donate'::text, 'bulk'::text, 'took_all'::text])));
alter table public.dropoffs add constraint dropoffs_payment_choice_check CHECK ((payment_choice = ANY (ARRAY['cash'::text, 'credit'::text, 'none'::text])));
alter table public.dropoffs add constraint dropoffs_stage_check CHECK ((stage = ANY (ARRAY['intake'::text, 'tagging'::text, 'pricing'::text, 'awaiting_customer'::text, 'resolved'::text, 'cancelled'::text])));
alter table public.invites add constraint invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])));
alter table public.ls_sync_state add constraint ls_sync_state_singleton CHECK ((id = 1));
alter table public.ls_used_sku_catalog add constraint ls_used_sku_catalog_category_check CHECK ((category = ANY (ARRAY['clothing'::text, 'maternity'::text, 'non-clothing'::text])));
alter table public.memberships add constraint memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])));
alter table public.staff_profiles add constraint staff_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'tagger'::text, 'pricer'::text, 'associate'::text])));

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
alter table public.activity_log add constraint activity_log_dropoff_id_fkey FOREIGN KEY (dropoff_id) REFERENCES public.dropoffs(id) ON DELETE CASCADE;
alter table public.activity_log add constraint activity_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
alter table public.ai_usage add constraint ai_usage_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
alter table public.ai_usage add constraint ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.customers add constraint customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
alter table public.dropoffs add constraint dropoffs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
alter table public.dropoffs add constraint dropoffs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
alter table public.invites add constraint invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
alter table public.invites add constraint invites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
alter table public.ls_sale_line_items add constraint ls_sale_line_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.ls_sales(id) ON DELETE CASCADE;
alter table public.ls_sale_payments add constraint ls_sale_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.ls_sales(id) ON DELETE CASCADE;
alter table public.memberships add constraint memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
alter table public.memberships add constraint memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.pricing_config add constraint pricing_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
alter table public.settings add constraint settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
alter table public.staff_profiles add constraint staff_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes (non-constraint). NOTE: live carries several exact duplicates
-- (e.g. customers_email_idx == idx_customers_email_lower, customers_phone_idx
-- == idx_customers_phone, dropoffs_customer_idx == idx_dropoffs_customer,
-- activity_dropoff_idx covers idx_activity_log_dropoff, offer_token has a
-- UNIQUE constraint + a partial unique index + a plain index). They are kept
-- here so staging matches live; a cleanup migration can drop them later.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS activity_dropoff_idx ON public.activity_log USING btree (dropoff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customers_email_idx ON public.customers USING btree (lower(email));
CREATE INDEX IF NOT EXISTS customers_name_idx ON public.customers USING btree (lower(name));
CREATE INDEX IF NOT EXISTS customers_phone_idx ON public.customers USING btree (phone);
CREATE INDEX IF NOT EXISTS dropoffs_customer_idx ON public.dropoffs USING btree (customer_id);
CREATE INDEX IF NOT EXISTS dropoffs_deleted_at_idx ON public.dropoffs USING btree (deleted_at) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS dropoffs_dropped_at_idx ON public.dropoffs USING btree (dropped_at DESC);
CREATE INDEX IF NOT EXISTS dropoffs_offer_token_idx ON public.dropoffs USING btree (offer_token);
CREATE INDEX IF NOT EXISTS dropoffs_stage_idx ON public.dropoffs USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_activity_log_dropoff ON public.activity_log USING btree (dropoff_id);
CREATE INDEX IF NOT EXISTS idx_activity_tenant_dropoff ON public.activity_log USING btree (tenant_id, dropoff_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant ON public.ai_usage USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON public.ai_usage USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_email_lower ON public.customers USING btree (lower(email));
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers USING btree (phone);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_email ON public.customers USING btree (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON public.customers USING btree (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_dropoffs_customer ON public.dropoffs USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_dropoffs_stage_dropped ON public.dropoffs USING btree (stage, dropped_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_dropoffs_tenant_dropped ON public.dropoffs USING btree (tenant_id, dropped_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_dropoffs_tenant_stage ON public.dropoffs USING btree (tenant_id, stage, dropped_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.invites USING btree (lower(email));
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships USING btree (user_id);
CREATE INDEX IF NOT EXISTS ls_lines_brand_idx ON public.ls_sale_line_items USING btree (brand_id);
CREATE INDEX IF NOT EXISTS ls_lines_product_idx ON public.ls_sale_line_items USING btree (product_id);
CREATE INDEX IF NOT EXISTS ls_lines_sale_idx ON public.ls_sale_line_items USING btree (sale_id);
CREATE INDEX IF NOT EXISTS ls_lines_sold_at_idx ON public.ls_sale_line_items USING btree (sold_at DESC);
CREATE INDEX IF NOT EXISTS ls_lines_type_idx ON public.ls_sale_line_items USING btree (product_type_id);
CREATE INDEX IF NOT EXISTS ls_lines_used_idx ON public.ls_sale_line_items USING btree (is_used);
CREATE INDEX IF NOT EXISTS ls_payments_sale_idx ON public.ls_sale_payments USING btree (sale_id);
CREATE INDEX IF NOT EXISTS ls_payments_type_idx ON public.ls_sale_payments USING btree (payment_type_id);
CREATE INDEX IF NOT EXISTS ls_products_active_idx ON public.ls_products USING btree (is_active) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS ls_products_brand_idx ON public.ls_products USING btree (brand_id);
CREATE INDEX IF NOT EXISTS ls_products_category_idx ON public.ls_products USING btree (category_id);
CREATE INDEX IF NOT EXISTS ls_products_inventory_idx ON public.ls_products USING btree (inventory_level) WHERE (inventory_level IS NOT NULL);
CREATE INDEX IF NOT EXISTS ls_products_type_idx ON public.ls_products USING btree (product_type_id);
CREATE INDEX IF NOT EXISTS ls_products_used_idx ON public.ls_products USING btree (is_used_sku) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS ls_sales_date_idx ON public.ls_sales USING btree (sale_date DESC);
CREATE INDEX IF NOT EXISTS ls_sales_hour_idx ON public.ls_sales USING btree (EXTRACT(hour FROM (sale_date AT TIME ZONE 'America/New_York'::text)));
CREATE INDEX IF NOT EXISTS ls_sales_outlet_idx ON public.ls_sales USING btree (outlet_id);
CREATE INDEX IF NOT EXISTS ls_sales_status_idx ON public.ls_sales USING btree (status) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS ls_sales_user_idx ON public.ls_sales USING btree (user_id);
CREATE INDEX IF NOT EXISTS ls_sales_version_idx ON public.ls_sales USING btree (version DESC);
CREATE INDEX IF NOT EXISTS ls_used_sku_catalog_counts_idx ON public.ls_used_sku_catalog USING btree (counts_as_used);
CREATE INDEX IF NOT EXISTS staff_profiles_email_idx ON public.staff_profiles USING btree (lower(email));
CREATE INDEX IF NOT EXISTS staff_profiles_role_idx ON public.staff_profiles USING btree (role) WHERE (is_active = true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dropoffs_offer_token ON public.dropoffs USING btree (offer_token) WHERE (offer_token IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_tenant ON public.pricing_config USING btree (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_tenant ON public.settings USING btree (tenant_id);
