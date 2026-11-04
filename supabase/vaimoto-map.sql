-- Add coordinates and scoped live driver locations to the existing isolated VaiMoto schema.
-- This migration does not modify the original FlashTaxi rides, bids, profiles, or vehicle tables.
begin;

alter table public.vaimoto_rides
  add column if not exists pickup_latitude double precision,
  add column if not exists pickup_longitude double precision,
  add column if not exists destination_latitude double precision,
  add column if not exists destination_longitude double precision,
  add column if not exists pickup_location_source text,
  add column if not exists destination_location_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vaimoto_rides'::regclass
      and conname = 'vaimoto_rides_pickup_coordinates_check'
  ) then
    alter table public.vaimoto_rides
      add constraint vaimoto_rides_pickup_coordinates_check
      check (
        (pickup_latitude is null and pickup_longitude is null)
        or (
          pickup_latitude is not null
          and pickup_longitude is not null
          and
          pickup_latitude between -90 and 90
          and pickup_longitude between -180 and 180
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vaimoto_rides'::regclass
      and conname = 'vaimoto_rides_destination_coordinates_check'
  ) then
    alter table public.vaimoto_rides
      add constraint vaimoto_rides_destination_coordinates_check
      check (
        (destination_latitude is null and destination_longitude is null)
        or (
          destination_latitude is not null
          and destination_longitude is not null
          and
          destination_latitude between -90 and 90
          and destination_longitude between -180 and 180
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vaimoto_rides'::regclass
      and conname = 'vaimoto_rides_pickup_location_source_check'
  ) then
    alter table public.vaimoto_rides
      add constraint vaimoto_rides_pickup_location_source_check
      check (
        pickup_location_source is null
        or (
          pickup_location_source in ('geocoded', 'manual', 'device', 'text_only')
          and (
            (pickup_location_source in ('geocoded', 'manual', 'device')
              and pickup_latitude is not null and pickup_longitude is not null)
            or (pickup_location_source = 'text_only'
              and pickup_latitude is null and pickup_longitude is null)
          )
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vaimoto_rides'::regclass
      and conname = 'vaimoto_rides_destination_location_source_check'
  ) then
    alter table public.vaimoto_rides
      add constraint vaimoto_rides_destination_location_source_check
      check (
        destination_location_source is null
        or (
          destination_location_source in ('geocoded', 'manual', 'device', 'text_only')
          and (
            (destination_location_source in ('geocoded', 'manual', 'device')
              and destination_latitude is not null and destination_longitude is not null)
            or (destination_location_source = 'text_only'
              and destination_latitude is null and destination_longitude is null)
          )
        )
      );
  end if;
end;
$$;

alter table public.vaimoto_driver_locations
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vaimoto_driver_locations'::regclass
      and conname = 'vaimoto_driver_locations_coordinates_check'
  ) then
    alter table public.vaimoto_driver_locations
      add constraint vaimoto_driver_locations_coordinates_check
      check (
        (latitude is null and longitude is null)
        or (
          latitude is not null
          and longitude is not null
          and latitude between -90 and 90
          and longitude between -180 and 180
        )
      );
  end if;
end;
$$;

create or replace function vaimoto_private.can_view_driver_location(p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.vaimoto_rides r
    join public.vaimoto_ride_offers o on o.id = r.selected_offer_id
    where r.customer_id = auth.uid()
      and o.driver_id = p_driver_id
      and r.status in ('confirmed', 'in_progress')
  );
$$;

revoke all on function vaimoto_private.can_view_driver_location(uuid) from public, anon;
grant usage on schema vaimoto_private to authenticated;
grant execute on function vaimoto_private.can_view_driver_location(uuid) to authenticated;

grant select on public.vaimoto_driver_locations to authenticated;

drop policy if exists vaimoto_driver_locations_select_assigned_rides on public.vaimoto_driver_locations;
create policy vaimoto_driver_locations_select_assigned_rides
  on public.vaimoto_driver_locations
  for select
  to authenticated
  using (
    driver_id = (select auth.uid())
    or vaimoto_private.can_view_driver_location(driver_id)
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'vaimoto_driver_locations'
     ) then
    alter publication supabase_realtime add table public.vaimoto_driver_locations;
  end if;
end;
$$;

commit;
