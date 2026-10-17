-- Read-only RLS audit. Run manually in the Supabase SQL editor; changes nothing.
-- Pass: every row has relrowsecurity = true and policies > 0.
-- Tables created from the dashboard (not via migrations) are what this catches.

-- 1) RLS flag + policy count per public table
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 2, 1;

-- 2) The policies themselves, for review
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
