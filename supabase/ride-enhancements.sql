-- Apply after schema.sql, driver-approval.sql, and realtime-flow.sql.
-- Adds profile/vehicle fields, persisted arrival timing, and atomic trip actions.
begin;

alter table public.profiles
  add column if not exists username text,
  add column if not exists vehicle_type text,
  add column if not exists vehicle_brand text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_color text,
  add column if not exists vehicle_plate text;

alter table public.rides
  add column if not exists arrival_started_at timestamptz,
  add column if not exists arrival_deadline_at timestamptz,
  add column if not exists trip_started_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

update public.rides
set cancelled_at = updated_at
where status = 'cancelled' and cancelled_at is null;

update public.profiles
set avatar_url = null
where avatar_url is not null
  and avatar_url !~ (
    '^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
  );

update public.driver_locations dl
set is_available = false
from public.profiles p
where p.id = dl.driver_id
  and dl.is_available = true
  and p.role = 'driver'
  and (
    p.vehicle_type is null
    or p.vehicle_color is null
    or p.vehicle_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_format_check') then
    alter table public.profiles add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-z0-9._]{3,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_vehicle_type_check') then
    alter table public.profiles add constraint profiles_vehicle_type_check
      check (vehicle_type is null or vehicle_type in ('motorcycle', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_vehicle_color_check') then
    alter table public.profiles add constraint profiles_vehicle_color_check
      check (vehicle_color is null or char_length(trim(vehicle_color)) between 2 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_vehicle_plate_check') then
    alter table public.profiles add constraint profiles_vehicle_plate_check
      check (vehicle_plate is null or vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_url_owner_check') then
    alter table public.profiles add constraint profiles_avatar_url_owner_check
      check (
        avatar_url is null
        or avatar_url ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$')
      );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.rides'::regclass and conname = 'rides_cancellation_metadata_check') then
    alter table public.rides add constraint rides_cancellation_metadata_check
      check (
        (status = 'cancelled' and cancelled_at is not null)
        or (status <> 'cancelled' and cancelled_by is null and cancelled_at is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.rides'::regclass and conname = 'rides_arrival_deadline_check') then
    alter table public.rides add constraint rides_arrival_deadline_check
      check (arrival_started_at is null or (arrival_deadline_at is not null and arrival_deadline_at >= arrival_started_at));
  end if;
end;
$$;

create or replace function public.normalize_profile_identifiers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is not null then
    new.username := lower(btrim(new.username));
    if new.username = '' then new.username := null; end if;
  end if;
  if new.vehicle_plate is not null then
    new.vehicle_plate := upper(regexp_replace(btrim(new.vehicle_plate), '[[:space:]-]+', '', 'g'));
    if new.vehicle_plate = '' then new.vehicle_plate := null; end if;
  end if;
  if new.vehicle_color is not null then
    new.vehicle_color := btrim(new.vehicle_color);
  end if;
  if new.vehicle_brand is not null then
    new.vehicle_brand := nullif(btrim(new.vehicle_brand), '');
  end if;
  if new.vehicle_model is not null then
    new.vehicle_model := nullif(btrim(new.vehicle_model), '');
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_normalize_identifiers on public.profiles;
create trigger profiles_normalize_identifiers
before insert or update on public.profiles
for each row execute procedure public.normalize_profile_identifiers();

create or replace function public.prevent_incomplete_online_driver_vehicle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'driver'
     and exists (
       select 1 from public.driver_locations dl
       where dl.driver_id = new.id and dl.is_available = true
     )
     and (
       new.vehicle_type is null
       or new.vehicle_color is null
       or new.vehicle_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
     ) then
    raise exception 'Vehicle type, color, and a valid plate are required while online';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_vehicle_while_online on public.profiles;
create trigger profiles_require_vehicle_while_online
before update on public.profiles
for each row execute procedure public.prevent_incomplete_online_driver_vehicle();

drop view if exists public.driver_public_profiles;
create view public.driver_public_profiles with (security_barrier = true) as
  select id, full_name, username
  from public.profiles
  where role = 'driver' and driver_approval_status = 'approved';
grant select on public.driver_public_profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_photos_read_authorized" on storage.objects;
create policy "profile_photos_read_authorized" on storage.objects
for select to authenticated using (
  bucket_id = 'profile-photos'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.rides r
      where r.customer_id::text = (storage.foldername(name))[1]
        and (
          (
            r.status = 'searching'
            and r.expires_at > now()
            and exists (
              select 1 from public.profiles driver
              join public.driver_locations dl on dl.driver_id = driver.id
              where driver.id = (select auth.uid())
                and driver.role = 'driver'
                and driver.driver_approval_status = 'approved'
                and dl.is_available = true
            )
          )
          or exists (
            select 1 from public.ride_offers assigned
            where assigned.id = r.selected_offer_id
              and assigned.driver_id = (select auth.uid())
              and exists (
                select 1 from public.profiles driver
                where driver.id = (select auth.uid())
                  and driver.role = 'driver'
                  and driver.driver_approval_status = 'approved'
              )
              and r.status in ('confirmed', 'in_progress')
          )
        )
    )
    or exists (
      select 1
      from public.rides r
      join public.ride_offers o on o.ride_id = r.id
      where r.customer_id = (select auth.uid())
        and o.driver_id::text = (storage.foldername(name))[1]
        and o.status in ('pending', 'accepted')
        and (o.status = 'accepted' or o.expires_at > now())
        and (
          r.status in ('confirmed', 'in_progress')
          or (r.status in ('searching', 'offered') and r.expires_at > now())
        )
    )
  )
);

drop policy if exists "profile_photos_insert_own" on storage.objects;
create policy "profile_photos_insert_own" on storage.objects
for insert to authenticated with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_photos_update_own" on storage.objects;
create policy "profile_photos_update_own" on storage.objects
for update to authenticated using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
) with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_photos_delete_own" on storage.objects;
create policy "profile_photos_delete_own" on storage.objects
for delete to authenticated using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "locations_insert_self_driver" on public.driver_locations;
create policy "locations_insert_self_driver" on public.driver_locations
for insert to authenticated with check (
  driver_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'driver'
      and p.driver_approval_status = 'approved'
      and (
        not is_available
        or (
          p.vehicle_type is not null
          and p.vehicle_color is not null
          and p.vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
        )
      )
  )
);

drop policy if exists "locations_update_self_driver" on public.driver_locations;
create policy "locations_update_self_driver" on public.driver_locations
for update to authenticated using (driver_id = (select auth.uid())) with check (
  driver_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'driver'
      and p.driver_approval_status = 'approved'
      and (
        not is_available
        or (
          p.vehicle_type is not null
          and p.vehicle_color is not null
          and p.vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
        )
      )
  )
);

create or replace function public.accept_ride_offer(p_offer_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.ride_offers;
  v_ride public.rides;
  v_now timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found then raise exception 'Offer not found'; end if;

  select * into v_ride from public.rides where id = v_offer.ride_id for update;
  if not found or v_ride.customer_id <> (select auth.uid()) then
    raise exception 'Ride not found';
  end if;

  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found'; end if;

  if v_ride.status not in ('searching', 'offered')
     or v_ride.expires_at <= v_now
     or v_offer.status <> 'pending'
     or v_offer.expires_at <= v_now then
    raise exception 'Ride or offer is no longer available';
  end if;

  update public.rides
  set status = 'confirmed',
      selected_offer_id = v_offer.id,
      arrival_started_at = v_now,
      arrival_deadline_at = v_now + make_interval(mins => v_offer.eta_minutes),
      trip_started_at = null,
      cancelled_by = null,
      cancelled_at = null,
      cancellation_reason = null
  where id = v_ride.id
  returning * into v_ride;

  update public.ride_offers
  set status = case when id = v_offer.id then 'accepted'::public.offer_status else 'rejected'::public.offer_status end
  where ride_id = v_ride.id and status = 'pending';

  return v_ride;
end;
$$;

revoke all on function public.accept_ride_offer(uuid) from public;
grant execute on function public.accept_ride_offer(uuid) to authenticated;

create or replace function public.cancel_ride(p_ride_id uuid, p_reason text default null)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_actor uuid := (select auth.uid());
  v_driver_id uuid;
begin
  if v_actor is null then raise exception 'Authentication is required'; end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;

  if v_ride.status = 'cancelled' then raise exception 'Ride is already cancelled'; end if;
  if v_ride.status = 'in_progress' then
    raise exception 'A ride in progress cannot be cancelled with the standard cancellation action; contact support';
  end if;
  if v_ride.status not in ('searching', 'offered', 'confirmed') then
    raise exception 'Ride is no longer cancellable';
  end if;

  if v_ride.selected_offer_id is not null then
    select driver_id into v_driver_id
    from public.ride_offers
    where id = v_ride.selected_offer_id;
  end if;

  if v_actor <> v_ride.customer_id
     and (v_ride.status <> 'confirmed' or v_actor is distinct from v_driver_id) then
    raise exception 'Only the customer or the assigned driver may cancel this ride';
  end if;

  update public.rides
  set status = 'cancelled',
      cancelled_by = v_actor,
      cancelled_at = clock_timestamp(),
      cancellation_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
  where id = v_ride.id
  returning * into v_ride;

  update public.ride_offers
  set status = 'withdrawn'
  where ride_id = v_ride.id and status = 'pending';

  return v_ride;
end;
$$;

revoke all on function public.cancel_ride(uuid, text) from public;
grant execute on function public.cancel_ride(uuid, text) to authenticated;

create or replace function public.start_ride(p_ride_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_driver_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;

  select driver_id into v_driver_id
  from public.ride_offers
  where id = v_ride.selected_offer_id;

  if v_driver_id is distinct from (select auth.uid()) then
    raise exception 'Only the assigned driver may start this ride';
  end if;
  if v_ride.status <> 'confirmed' then
    raise exception 'Only a confirmed ride can be started';
  end if;

  update public.rides
  set status = 'in_progress',
      trip_started_at = clock_timestamp()
  where id = v_ride.id
  returning * into v_ride;

  return v_ride;
end;
$$;

revoke all on function public.start_ride(uuid) from public;
grant execute on function public.start_ride(uuid) to authenticated;

create or replace function public.get_customer_ride_driver(p_ride_id uuid)
returns table (
  driver_id uuid,
  username text,
  full_name text,
  avatar_url text,
  vehicle_type text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_color text,
  vehicle_plate text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;

  return query
  select p.id, p.username, p.full_name, p.avatar_url, p.vehicle_type, p.vehicle_brand, p.vehicle_model, p.vehicle_color, p.vehicle_plate
  from public.rides r
  join public.ride_offers o on o.id = r.selected_offer_id
  join public.profiles p on p.id = o.driver_id
  where r.id = p_ride_id
    and r.customer_id = (select auth.uid())
    and r.status in ('confirmed', 'in_progress', 'completed', 'cancelled');
end;
$$;

revoke all on function public.get_customer_ride_driver(uuid) from public;
grant execute on function public.get_customer_ride_driver(uuid) to authenticated;

create or replace function public.get_customer_ride_offer_drivers(p_ride_id uuid)
returns table (
  offer_id uuid,
  driver_id uuid,
  username text,
  full_name text,
  avatar_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;

  return query
  select o.id, p.id, p.username, p.full_name, p.avatar_url
  from public.rides r
  join public.ride_offers o on o.ride_id = r.id
  join public.profiles p on p.id = o.driver_id
  where r.id = p_ride_id
    and r.customer_id = (select auth.uid())
    and r.status in ('searching', 'offered', 'confirmed', 'in_progress')
    and o.status in ('pending', 'accepted')
    and (o.status = 'accepted' or o.expires_at > clock_timestamp());
end;
$$;

revoke all on function public.get_customer_ride_offer_drivers(uuid) from public;
grant execute on function public.get_customer_ride_offer_drivers(uuid) to authenticated;

create or replace function public.get_driver_ride_customer(p_ride_id uuid)
returns table (
  customer_id uuid,
  username text,
  full_name text,
  avatar_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;

  return query
  select p.id, p.username, p.full_name, p.avatar_url
  from public.rides r
  join public.profiles p on p.id = r.customer_id
  where r.id = p_ride_id
    and (
      (
        r.status = 'searching'
        and r.expires_at > clock_timestamp()
        and exists (
          select 1
          from public.profiles driver
          join public.driver_locations dl on dl.driver_id = driver.id
          where driver.id = (select auth.uid())
            and driver.role = 'driver'
            and driver.driver_approval_status = 'approved'
            and dl.is_available = true
        )
      )
      or exists (
        select 1 from public.ride_offers o
        where o.id = r.selected_offer_id
          and o.driver_id = (select auth.uid())
          and exists (
            select 1 from public.profiles driver
            where driver.id = (select auth.uid())
              and driver.role = 'driver'
              and driver.driver_approval_status = 'approved'
          )
          and r.status in ('confirmed', 'in_progress')
      )
    );
end;
$$;

revoke all on function public.get_driver_ride_customer(uuid) from public;
grant execute on function public.get_driver_ride_customer(uuid) to authenticated;

drop policy if exists "rides_driver_select_assigned" on public.rides;
create policy "rides_driver_select_assigned" on public.rides
for select to authenticated using (
  selected_offer_id is not null
  and exists (
    select 1 from public.ride_offers o
    where o.id = selected_offer_id and o.driver_id = (select auth.uid())
  )
);

commit;
