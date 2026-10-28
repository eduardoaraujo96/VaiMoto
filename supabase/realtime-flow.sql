-- Apply after schema.sql to upgrade an existing VaiMoto Supabase project.
drop policy if exists "rides_driver_select_searching" on public.rides;
create policy "rides_driver_select_searching" on public.rides
for select to authenticated using (
  status = 'searching'
  and expires_at > now()
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'driver'
      and p.driver_approval_status = 'approved'
  )
  and exists (
    select 1 from public.driver_locations dl
    where dl.driver_id = (select auth.uid())
      and dl.is_available = true
  )
);

drop policy if exists "rides_customer_update_own_searching" on public.rides;
drop policy if exists "offers_driver_update_own_pending" on public.ride_offers;

drop policy if exists "offers_insert_driver_own" on public.ride_offers;
create policy "offers_insert_driver_own" on public.ride_offers
for insert to authenticated with check (
  driver_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'driver'
      and p.driver_approval_status = 'approved'
  )
  and exists (
    select 1 from public.driver_locations dl
    where dl.driver_id = (select auth.uid())
      and dl.is_available = true
  )
  and exists (
    select 1 from public.rides r
    where r.id = ride_id and r.status = 'searching' and r.expires_at > now()
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
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  select * into v_offer
  from public.ride_offers
  where id = p_offer_id;

  if not found then
    raise exception 'Offer not found';
  end if;

  select * into v_ride
  from public.rides
  where id = v_offer.ride_id
  for update;

  if not found or v_ride.customer_id <> (select auth.uid()) then
    raise exception 'Ride not found';
  end if;

  select * into v_offer
  from public.ride_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception 'Offer not found';
  end if;

  if v_ride.status not in ('searching', 'offered')
     or v_ride.expires_at <= clock_timestamp()
     or v_offer.status <> 'pending'
     or v_offer.expires_at <= clock_timestamp() then
    raise exception 'Ride or offer is no longer available';
  end if;

  update public.rides
  set status = 'confirmed',
      selected_offer_id = v_offer.id
  where id = v_ride.id
  returning * into v_ride;

  update public.ride_offers
  set status = case
    when id = v_offer.id then 'accepted'::public.offer_status
    else 'rejected'::public.offer_status
  end
  where ride_id = v_ride.id and status = 'pending';

  return v_ride;
end;
$$;

revoke all on function public.accept_ride_offer(uuid) from public;
grant execute on function public.accept_ride_offer(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rides'
  ) then
    execute 'alter publication supabase_realtime add table public.rides';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ride_offers'
  ) then
    execute 'alter publication supabase_realtime add table public.ride_offers';
  end if;
end;
$$;
