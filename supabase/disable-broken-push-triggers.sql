-- Remove Database Webhook triggers that call supabase_functions.http_request
-- on VaiMoto/FlashTaxi ride tables. Those triggers run in the same transaction
-- as the insert; invalid JSON headers abort the proposal with:
--   invalid input syntax for type json
--
-- After this script, sending an offer works again. Recreate push delivery
-- from Database → Webhooks (recommended) or with fix-vaimoto-push-trigger.sql.
begin;

do $$
declare
  rec record;
  dropped integer := 0;
begin
  for rec in
    select n.nspname as schema_name,
           c.relname as table_name,
           t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and n.nspname = 'public'
      and c.relname in ('vaimoto_rides', 'vaimoto_ride_offers', 'rides', 'ride_offers')
      and pn.nspname = 'supabase_functions'
      and p.proname = 'http_request'
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      rec.trigger_name,
      rec.schema_name,
      rec.table_name
    );
    dropped := dropped + 1;
    raise notice 'Dropped %.% trigger %', rec.schema_name, rec.table_name, rec.trigger_name;
  end loop;

  if dropped = 0 then
    raise notice 'No supabase_functions.http_request triggers found on ride tables.';
  end if;
end;
$$;

commit;
