-- ============================================================================
-- STAGING ONLY (qngqrvgcqunywyemzesy). NEVER run against live.
-- 60 fake customers + 150 fake drop-offs covering every stage the app uses.
-- Deterministic (generate_series), re-runnable: skips if seed rows exist.
-- Names/emails/phones/Venmo are synthetic: Test Seller NNNN,
-- sellerNNNN@example.test, 555-010-NNNN, @test-seller-NNNN.
--
-- Stage mix per i % 15 (i = 1..150, 10 of each):
--   0  intake               new bag, nothing done
--   1  tagging              being tagged
--   2  pricing              tagged, not yet priced
--   3  pricing              priced (amounts + pricing_lines), offer not sent
--   4  awaiting_customer    offer sent, no response
--   5  awaiting_customer    offer sent, reminder sent, no response
--   6  awaiting_customer    responded cash + donate  (Ready to Pay)
--   7  awaiting_customer    responded credit + pickup (Ready to Pay)
--   8  awaiting_pickup      paid credit, leftovers waiting   (needs 0004)
--   9  resolved             paid cash, donated
--   10 resolved             paid credit, donated
--   11 resolved             paid credit, picked up
--   12 resolved             took none (payment none), donated
--   13 resolved             bulk drop, paid credit, leftover 'bulk'
--   14 cancelled (i<=60) / resolved cash took_all (i>60); i=14 soft-deleted
-- ============================================================================
do $$
begin
  if (select count(*) from public.dropoffs) > 1000 then
    raise exception 'refusing to seed: >1000 drop-offs present (live?)';
  end if;
  if exists (select 1 from public.customers where email = 'seller0001@example.test') then
    raise notice 'seed already present, skipping';
    return;
  end if;

  insert into public.customers (tenant_id, name, email, phone, venmo_handle, notes, created_at)
  select '95ba216b-2f0a-470b-accd-c4b8c08b333e',
         'Test Seller ' || lpad(n::text, 4, '0'),
         'seller' || lpad(n::text, 4, '0') || '@example.test',
         '555-010-' || lpad(n::text, 4, '0'),
         case when n % 3 = 0 then null else '@test-seller-' || lpad(n::text, 4, '0') end,
         case when n % 10 = 0 then 'seed: synthetic customer' end,
         now() - interval '200 days' + (n || ' hours')::interval
  from generate_series(1, 60) n;

  with base as (
    select i, i % 15 as k,
      ((i - 1) % 60) + 1 as cust_n,
      (20 + (i * 7) % 80)::numeric as resale,
      case when i % 15 between 0 and 8
           then now() - ((i % 12) || ' days')::interval - ((i % 7) || ' hours')::interval
           else now() - ((15 + (150 - i)) || ' days')::interval end as dt
    from generate_series(1, 150) i
  )
  insert into public.dropoffs (
    tenant_id, customer_id, drop_type, bag_description, donate_all, consented, dropped_at, stage,
    tagged_at, tagged_by, item_count, priced_at, priced_by, venmo_amount, credit_amount, pricing_lines,
    offer_sent_at, offer_token, reminder_sent_at, reminder_count, customer_responded_at,
    payment_choice, leftover_choice, resolved_at, paid_at, paid_by, picked_up_at, picked_up_by,
    notes, deleted_at, deleted_by)
  select
    '95ba216b-2f0a-470b-accd-c4b8c08b333e',
    c.id,
    case when b.k = 13 then 'bulk' else 'standard' end,
    'Test bag ' || b.i || ': ' || (array['blue tote','2 grocery bags','black trash bag','laundry basket','IKEA bag'])[1 + b.i % 5],
    (b.k in (12, 13)),
    true,
    b.dt,
    case b.k when 0 then 'intake' when 1 then 'tagging' when 2 then 'pricing' when 3 then 'pricing'
             when 4 then 'awaiting_customer' when 5 then 'awaiting_customer' when 6 then 'awaiting_customer'
             when 7 then 'awaiting_customer' when 8 then 'awaiting_pickup'
             when 14 then case when b.i <= 60 then 'cancelled' else 'resolved' end
             else 'resolved' end,
    -- tagged
    case when b.k >= 2 then b.dt + interval '1 day' end,
    case when b.k >= 2 then 'staff@example.test' end,
    case when b.k >= 2 then 5 + b.i % 20 end,
    -- priced
    case when b.k >= 3 then b.dt + interval '2 days' end,
    case when b.k >= 3 then 'manager@example.test' end,
    case when b.k >= 3 then round(b.resale * 0.3, 2) end,
    case when b.k >= 3 then round(b.resale * 0.4, 2) end,
    case when b.k >= 3 and b.k <> 13 then jsonb_build_array(
        jsonb_build_object('brand','Carters','type','Tshirt','size','Toddler (Cothes: 18mo-5T) (Shoes: 5C-13C)','tier','Good','price',2,'qty',(b.resale/4)::int),
        jsonb_build_object('brand','Gap','type','Jeans','size','Kid (Clothes: 6-10) (Shoes: 1Y and Up)','tier','Even Better','price',7,'qty',1),
        jsonb_build_object('brand','Nike','type','Sneakers (shoes)','size','Kid (Clothes: 6-10) (Shoes: 1Y and Up)','tier','Best','price',(b.resale - 2*(b.resale/4)::int - 7),'qty',1))
      else '[]'::jsonb end,
    -- offer
    case when b.k >= 4 and not (b.k = 14 and b.i <= 60) then b.dt + interval '3 days' end,
    case when b.k >= 4 and not (b.k = 14 and b.i <= 60) then 'TESTTOKEN' || lpad(b.i::text, 4, '0') || md5('seed' || b.i) end,
    case when b.k = 5 then b.dt + interval '7 days' end,
    case when b.k = 5 then 1 else 0 end,
    -- response
    case when b.k >= 6 and not (b.k = 14 and b.i <= 60) then b.dt + interval '4 days' end,
    case b.k when 6 then 'cash' when 7 then 'credit' when 8 then 'credit' when 9 then 'cash' when 10 then 'credit'
             when 11 then 'credit' when 12 then 'none' when 13 then 'credit'
             when 14 then case when b.i <= 60 then null else 'cash' end end,
    case b.k when 6 then 'donate' when 7 then 'pickup' when 8 then 'pickup' when 9 then 'donate' when 10 then 'donate'
             when 11 then 'pickup' when 12 then 'donate' when 13 then 'bulk'
             when 14 then case when b.i <= 60 then null else 'took_all' end end,
    -- resolved / paid / picked up
    case when b.k >= 9 then b.dt + interval '6 days' end,
    case when b.k in (8, 9, 10, 11, 13) or (b.k = 14 and b.i > 60) then b.dt + interval '5 days' end,
    case when b.k in (8, 9, 10, 11, 13) or (b.k = 14 and b.i > 60) then 'owner@example.test' end,
    case when b.k = 11 then b.dt + interval '6 days' end,
    case when b.k = 11 then 'staff@example.test' end,
    case when b.k = 14 and b.i <= 60 then 'seed: cancelled test bag' end,
    case when b.i = 14 then now() - interval '1 day' end,
    case when b.i = 14 then 'owner@example.test' end
  from base b
  join public.customers c
    on c.tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e'
   and c.email = 'seller' || lpad(b.cust_n::text, 4, '0') || '@example.test';

  -- bump_customer_drops trigger lives in 0002; keep total_drops right either way.
  update public.customers c set total_drops = sub.n
  from (select customer_id, count(*) n from public.dropoffs group by customer_id) sub
  where sub.customer_id = c.id;

  insert into public.activity_log (tenant_id, dropoff_id, actor, action, details, created_at)
  select tenant_id, id, 'seed', 'seeded', jsonb_build_object('stage', stage), dropped_at
  from public.dropoffs where tenant_id = '95ba216b-2f0a-470b-accd-c4b8c08b333e';
end $$;
