-- Apply after schema.sql, driver-approval.sql, realtime-flow.sql, and
-- ride-enhancements.sql. Adds secure ride completion, review, and reputation APIs.
begin;

alter table public.rides
  add column if not exists completed_at timestamptz;

update public.rides
set completed_at = updated_at
where status = 'completed' and completed_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rides'::regclass
      and conname = 'rides_completion_timestamp_check'
  ) then
    alter table public.rides add constraint rides_completion_timestamp_check
      check (
        (status = 'completed' and completed_at is not null)
        or (status <> 'completed' and completed_at is null)
      );
  end if;
end;
$$;

create table if not exists public.ride_reviews (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  reviewed_user_id uuid not null references public.profiles(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  constraint ride_reviews_one_per_reviewer unique (ride_id, reviewer_id),
  constraint ride_reviews_not_self check (reviewer_id <> reviewed_user_id)
);

create index if not exists ride_reviews_reviewed_created_idx
  on public.ride_reviews (reviewed_user_id, created_at desc);

drop policy if exists "profile_photos_read_authorized" on storage.objects;
create policy "profile_photos_read_authorized" on storage.objects
for select to authenticated using (
  bucket_id = 'profile-photos'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.rides r
      join public.ride_offers assigned on assigned.id = r.selected_offer_id
        and assigned.status = 'accepted'
      join public.profiles driver on driver.id = (select auth.uid())
        and driver.role = 'driver'
        and driver.driver_approval_status = 'approved'
      where r.customer_id::text = (storage.foldername(name))[1]
        and assigned.driver_id = (select auth.uid())
        and r.status in ('confirmed', 'in_progress', 'completed', 'cancelled')
    )
    or exists (
      select 1
      from public.rides r
      join public.ride_offers assigned on assigned.id = r.selected_offer_id
        and assigned.status = 'accepted'
      where r.customer_id = (select auth.uid())
        and assigned.driver_id::text = (storage.foldername(name))[1]
        and r.status in ('confirmed', 'in_progress', 'completed', 'cancelled')
    )
    or exists (
      select 1 from public.rides r
      where r.customer_id::text = (storage.foldername(name))[1]
        and r.status = 'searching'
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
      select 1
      from public.rides r
      join public.ride_offers o on o.ride_id = r.id
      where r.customer_id = (select auth.uid())
        and o.driver_id::text = (storage.foldername(name))[1]
        and o.status = 'pending'
        and o.expires_at > now()
        and r.status in ('searching', 'offered')
        and r.expires_at > now()
    )
  )
);

alter table public.ride_reviews enable row level security;
drop policy if exists "ride_reviews_select_participants" on public.ride_reviews;
create policy "ride_reviews_select_participants" on public.ride_reviews
for select to authenticated using (
  reviewer_id = (select auth.uid())
  or reviewed_user_id = (select auth.uid())
);

revoke all on public.ride_reviews from anon, authenticated;
grant select on public.ride_reviews to authenticated;

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
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;

  select * into v_offer from public.ride_offers where id = p_offer_id;
  if not found then raise exception 'Offer not found'; end if;

  select * into v_ride from public.rides where id = v_offer.ride_id for update;
  if not found or v_ride.customer_id <> (select auth.uid()) then
    raise exception 'Ride not found';
  end if;

  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found'; end if;

  perform pg_advisory_xact_lock(0, hashtext(v_offer.driver_id::text));
  if exists (
    select 1
    from public.rides active
    join public.ride_offers assigned on assigned.id = active.selected_offer_id
    where assigned.driver_id = v_offer.driver_id
      and active.status in ('confirmed', 'in_progress')
  ) then
    raise exception 'Driver already has an active ride';
  end if;

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
      completed_at = null,
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

create or replace function public.start_ride(p_ride_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_driver_id uuid := (select auth.uid());
begin
  if v_driver_id is null then raise exception 'Authentication is required'; end if;
  perform pg_advisory_xact_lock(0, hashtext(v_driver_id::text));

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;

  if not exists (
    select 1 from public.ride_offers o
    where o.id = v_ride.selected_offer_id and o.driver_id = v_driver_id
  ) then
    raise exception 'Only the assigned driver may start this ride';
  end if;
  if v_ride.status <> 'confirmed' then
    raise exception 'Only a confirmed ride can be started';
  end if;
  if exists (
    select 1
    from public.rides active
    join public.ride_offers assigned on assigned.id = active.selected_offer_id
    where assigned.driver_id = v_driver_id
      and active.id <> v_ride.id
      and active.status in ('confirmed', 'in_progress')
  ) then
    raise exception 'Driver already has another active ride';
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

create or replace function public.complete_ride(p_ride_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_driver_id uuid := (select auth.uid());
begin
  if v_driver_id is null then raise exception 'Authentication is required'; end if;
  perform pg_advisory_xact_lock(0, hashtext(v_driver_id::text));

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status <> 'in_progress' then
    raise exception 'Only a ride in progress can be completed';
  end if;
  if not exists (
    select 1 from public.ride_offers o
    where o.id = v_ride.selected_offer_id and o.driver_id = v_driver_id
  ) then
    raise exception 'Only the assigned driver may complete this ride';
  end if;

  update public.rides
  set status = 'completed',
      completed_at = clock_timestamp()
  where id = v_ride.id
  returning * into v_ride;
  return v_ride;
end;
$$;

revoke all on function public.complete_ride(uuid) from public;
grant execute on function public.complete_ride(uuid) to authenticated;

create or replace function public.submit_ride_review(
  p_ride_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.ride_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_reviewer uuid := (select auth.uid());
  v_driver uuid;
  v_reviewed uuid;
  v_review public.ride_reviews;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_reviewer is null then raise exception 'Authentication is required'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be an integer between 1 and 5';
  end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    raise exception 'Review comment must not exceed 1000 characters';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.status <> 'completed' or v_ride.completed_at is null then
    raise exception 'Only a completed ride can be reviewed';
  end if;
  select driver_id into v_driver
  from public.ride_offers
  where id = v_ride.selected_offer_id and status = 'accepted';
  if v_driver is null then raise exception 'Ride has no assigned driver'; end if;

  if v_reviewer = v_ride.customer_id then
    v_reviewed := v_driver;
  elsif v_reviewer = v_driver then
    v_reviewed := v_ride.customer_id;
  else
    raise exception 'Only a ride participant may submit a review';
  end if;

  insert into public.ride_reviews (ride_id, reviewer_id, reviewed_user_id, rating, comment)
  values (p_ride_id, v_reviewer, v_reviewed, p_rating, v_comment)
  on conflict (ride_id, reviewer_id) do nothing
  returning * into v_review;
  if not found then raise exception 'You have already reviewed this ride'; end if;
  return v_review;
end;
$$;

revoke all on function public.submit_ride_review(uuid, integer, text) from public;
grant execute on function public.submit_ride_review(uuid, integer, text) to authenticated;

create or replace function public.get_my_ride_history()
returns table (
  ride_id uuid,
  status public.ride_status,
  pickup_text text,
  destination_text text,
  created_at timestamptz,
  completed_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_full_name text,
  other_avatar_url text,
  other_average_rating numeric,
  other_review_count bigint,
  my_rating integer,
  my_comment text,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.status, r.pickup_text, r.destination_text, r.created_at, r.completed_at,
    other_profile.id, other_profile.username, other_profile.full_name, other_profile.avatar_url,
    (select round(avg(rv.rating)::numeric, 2) from public.ride_reviews rv where rv.reviewed_user_id = other_profile.id),
    (select count(*) from public.ride_reviews rv where rv.reviewed_user_id = other_profile.id),
    own_review.rating, own_review.comment, own_review.created_at
  from public.rides r
  join public.ride_offers accepted on accepted.id = r.selected_offer_id
    and accepted.status = 'accepted'
  join public.profiles other_profile on other_profile.id =
    case when r.customer_id = (select auth.uid()) then accepted.driver_id else r.customer_id end
  left join public.ride_reviews own_review on own_review.ride_id = r.id
    and own_review.reviewer_id = (select auth.uid())
  where (r.customer_id = (select auth.uid()) or accepted.driver_id = (select auth.uid()))
    and r.status in ('completed', 'cancelled')
  order by coalesce(r.completed_at, r.updated_at) desc, r.created_at desc;
$$;

revoke all on function public.get_my_ride_history() from public;
grant execute on function public.get_my_ride_history() to authenticated;

create or replace function public.get_my_reputation()
returns table (average_rating numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select round(avg(rating)::numeric, 2), count(*)
  from public.ride_reviews
  where reviewed_user_id = (select auth.uid());
$$;

revoke all on function public.get_my_reputation() from public;
grant execute on function public.get_my_reputation() to authenticated;

drop function if exists public.get_customer_ride_driver(uuid);
create function public.get_customer_ride_driver(p_ride_id uuid)
returns table (
  driver_id uuid,
  username text,
  full_name text,
  avatar_url text,
  vehicle_type text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_color text,
  vehicle_plate text,
  average_rating numeric,
  review_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  return query
  select p.id, p.username, p.full_name, p.avatar_url, p.vehicle_type,
    p.vehicle_brand, p.vehicle_model, p.vehicle_color, p.vehicle_plate,
    (select round(avg(rv.rating)::numeric, 2) from public.ride_reviews rv where rv.reviewed_user_id = p.id),
    (select count(*) from public.ride_reviews rv where rv.reviewed_user_id = p.id)
  from public.rides r
  join public.ride_offers o on o.id = r.selected_offer_id and o.status = 'accepted'
  join public.profiles p on p.id = o.driver_id
  where r.id = p_ride_id
    and r.customer_id = (select auth.uid())
    and r.status in ('confirmed', 'in_progress', 'completed', 'cancelled');
end;
$$;

revoke all on function public.get_customer_ride_driver(uuid) from public;
grant execute on function public.get_customer_ride_driver(uuid) to authenticated;

drop function if exists public.get_customer_ride_offer_drivers(uuid);
create function public.get_customer_ride_offer_drivers(p_ride_id uuid)
returns table (
  offer_id uuid,
  driver_id uuid,
  username text,
  full_name text,
  avatar_url text,
  average_rating numeric,
  review_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  return query
  select o.id, p.id, p.username, p.full_name, p.avatar_url,
    (select round(avg(rv.rating)::numeric, 2) from public.ride_reviews rv where rv.reviewed_user_id = p.id),
    (select count(*) from public.ride_reviews rv where rv.reviewed_user_id = p.id)
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

drop function if exists public.get_driver_ride_customer(uuid);
create function public.get_driver_ride_customer(p_ride_id uuid)
returns table (
  customer_id uuid,
  username text,
  full_name text,
  avatar_url text,
  average_rating numeric,
  review_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  return query
  select p.id, p.username, p.full_name, p.avatar_url,
    (select round(avg(rv.rating)::numeric, 2) from public.ride_reviews rv where rv.reviewed_user_id = p.id),
    (select count(*) from public.ride_reviews rv where rv.reviewed_user_id = p.id)
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
          and r.status in ('confirmed', 'in_progress', 'completed', 'cancelled')
      )
    );
end;
$$;

revoke all on function public.get_driver_ride_customer(uuid) from public;
grant execute on function public.get_driver_ride_customer(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ride_reviews'
  ) then
    execute 'alter publication supabase_realtime add table public.ride_reviews';
  end if;
end;
$$;

commit;
