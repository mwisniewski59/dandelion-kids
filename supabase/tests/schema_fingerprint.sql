-- Schema fingerprint: run on live, staging, or a local DB built from supabase/migrations
-- and compare. Catalog-only (no table data). MAINTAIN privilege is excluded because
-- PG16 does not have it. As of 2026-10-26, live and 0001-0003 applied locally both gave:
--   col 27 a7dd916dc95ea924e1aa044f0bb9f81e | con 53 f5cd011f644bf625ebceab10a15fe0ca
--   fgrant 58 d726672808afac6044fba2a8615c371f | fn 21 ce424870507744101615449b46364540
--   idx 77 da8574d9a2cf256c04b6631f30aed5b8 | pol 27 b86a82a4d2dde6e163b97837e9b257ff
--   rls 25 22fd4f0e0d1d56ebb79497f05dc7008c | tgrant 53 0c8d8ae10b6534f704c7675fa5762015
--   trg 5 0053203ee1f622ef577a62e7ecc982ad | view 2 c9afaf81d6df665ff841655f7b3edaf7
-- (with 0004 applied, 'col' and 'con' change as expected)
with x(k,n,h) as (
select 'fn' k, p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' n, md5(replace(pg_get_functiondef(p.oid), E'\r', '')) h
from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all select 'pol', tablename||'.'||policyname, md5(cmd||roles::text||coalesce(qual,'')||coalesce(with_check,'')) from pg_policies where schemaname='public'
union all select 'con', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace='public'::regnamespace
union all select 'idx', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid)) from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace
union all select 'view', c.relname, md5(pg_get_viewdef(c.oid)||coalesce(array_to_string(c.reloptions,','),'')) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v'
union all select 'col', c.relname, md5(string_agg(a.attname||format_type(a.atttypid,a.atttypmod)||a.attnotnull||coalesce(pg_get_expr(d.adbin,d.adrelid),''), ',' order by a.attname)) from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relkind in ('r','v') group by c.relname
union all select 'trg', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(t.oid)) from pg_trigger t where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace,'auth'::regnamespace))
union all select 'rls', relname, relrowsecurity::text||relforcerowsecurity::text from pg_class where relnamespace='public'::regnamespace and relkind='r'
union all select 'tgrant', c.relname||':'||r.rolname, string_agg(a.privilege_type, ',' order by a.privilege_type) from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a join pg_roles r on r.oid=a.grantee where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','S') and r.rolname in ('anon','authenticated') and a.privilege_type<>'MAINTAIN' group by 1,2
union all select 'fgrant', p.proname||':'||coalesce(r.rolname,'PUBLIC'), 'EXECUTE' from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid=a.grantee where p.pronamespace='public'::regnamespace and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))
)
select k, count(*), md5(string_agg(n||'|'||h, chr(10) order by n collate "C")) from x group by k order by k collate "C";
