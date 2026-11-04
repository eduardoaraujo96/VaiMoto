-- Enable Realtime delivery for open VaiMoto rides and proposal status changes.
-- This does not change table grants, RLS policies, or existing rows.
begin;

do $$
declare
  table_name text;
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication does not exist in this project.';
  end if;

  foreach table_name in array array['vaimoto_rides', 'vaimoto_ride_offers']
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Required VaiMoto table public.% does not exist.', table_name;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
