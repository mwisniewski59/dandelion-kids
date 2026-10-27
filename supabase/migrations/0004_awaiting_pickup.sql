-- ============================================================================
-- 0004 awaiting_pickup stage + picked_up_at / picked_up_by
--
-- *** NOT YET ON LIVE. ***  Applied to STAGING only (2026-10-26).
--
-- Why: dashboard.html on main already writes
--   stage = 'awaiting_pickup'               (markPaid when leftover_choice='pickup')
--   picked_up_at / picked_up_by             (markPickedUp, markPickupDonated, manual resolve)
-- but live's dropoffs_stage_check does not allow 'awaiting_pickup' and the two
-- columns do not exist, so on live those buttons fail (check-constraint /
-- unknown-column error from PostgREST). The Sellers' Sheet importer also needs
-- 'awaiting_pickup' for rows marked "picking up".
--
-- Additive and safe to run on live (no data rewrite). Apply to live only with
-- Mark present, after a backup, together with the importer run.
-- ============================================================================
alter table public.dropoffs add column if not exists picked_up_at timestamp with time zone;
alter table public.dropoffs add column if not exists picked_up_by text;

alter table public.dropoffs drop constraint if exists dropoffs_stage_check;
alter table public.dropoffs add constraint dropoffs_stage_check CHECK ((stage = ANY (ARRAY['intake'::text, 'tagging'::text, 'pricing'::text, 'awaiting_customer'::text, 'awaiting_pickup'::text, 'resolved'::text, 'cancelled'::text])));
