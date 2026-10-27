-- ============================================================================
-- 0005 Revoke anon table/view/sequence privileges; drop settings.admin_password_hash
--
-- Not yet applied to live or staging. Apply AFTER 0003 (see ordering note there).
--
-- Why:
--  * anon (the public, logged-out API role) held every table privilege on every
--    public table (Supabase defaults). RLS hid the rows, but defence in depth
--    says anon should hold nothing: the customer-facing pages (intake.html,
--    offer.html) only call the SECURITY DEFINER RPCs get_shop_public,
--    create_intake, get_offer_by_token and respond_to_offer, which run as
--    their owner and do not need anon table grants.
--  * Function EXECUTE grants are NOT touched here (the four RPCs plus the
--    has_role / auth_tenant_ids helpers stay callable as they are).
--  * settings.admin_password_hash is a leftover of the pre-login admin
--    password. Nothing on main reads it (grep of *.html / *.js / *.ts on
--    2026-10-27: only a test mock mentions it), yet every tenant member,
--    including staff, could read it through the settings_read policy.
-- ============================================================================

-- Tables and views (ALL TABLES includes views), and sequences.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Stop new objects created by the migration role from re-granting anon.
-- (Supabase sets these defaults for role postgres; objects created by other
-- roles, e.g. supabase_admin, are not covered: re-check after such changes.)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- Remove the legacy admin password hash.
update public.settings set admin_password_hash = null where admin_password_hash is not null;
alter table public.settings drop column if exists admin_password_hash;
