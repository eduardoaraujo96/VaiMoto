-- Persist the accepted offer value when a VaiMoto ride is completed and expose
-- participant-scoped earnings queries for the driver app.
begin;

create schema if not exists vaimoto_private;

do $$
begin
  if to_regclass('public.vaimoto_rides') is null
     or to_regclass('public.vaimoto_ride_offers') is null then
    raise exception 'Apply the VaiMoto isolated ride schema before this earnings migration.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vaimoto_rides'
      and column_name = 'completed_at'
  ) then
    raise exception 'public.vaimoto_rides.completed_at is required for the earnings migration.';
  end if;
end;
$$;

alter table public.vaimoto_rides
  add column if not exists final_fare numeric(10,2);

do $$
begin
  if exists (
    select 1 from public.vaimoto_rides r
    left join public.vaimoto_ride_offers o
      on o.id = r.selected_offer_id and o.status::text = 'accepted'
    where r.status::text = 'completed'
      and r.final_fare is null
      and o.price is null
  ) then
    raise exception 'A completed VaiMoto ride has no accepted offer price; resolve it before applying this migration.';
  end if;
end;
$$;

update public.vaimoto_rides r
set final_fare = o.price
from public.vaimoto_ride_offers o
where r.status::text = 'completed'
  and r.final_fare is null
  and o.id = r.selected_offer_id
  and o.status::text = 'accepted';

create or replace function vaimoto_private.set_ride_final_fare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accepted_price numeric(10,2);
begin
  if tg_op = 'UPDATE' and old.status::text = 'completed' then
    if new.status::text <> 'completed' then
      raise exception 'A completed ride cannot be reopened';
    end if;
    if new.selected_offer_id is distinct from old.selected_offer_id then
      raise exception 'The accepted offer of a completed ride is immutable';
    end if;
    if new.final_fare is distinct from old.final_fare then
      raise exception 'The final fare of a completed ride is immutable';
    end if;
    return new;
  end if;

  if new.status::text = 'completed' then
    select o.price into v_accepted_price
    from public.vaimoto_ride_offers o
    where o.id = new.selected_offer_id and o.status::text = 'accepted';
    if v_accepted_price is null then
      raise exception 'A ride can only be completed with an accepted offer price';
    end if;
    new.final_fare := v_accepted_price;
  else
    new.final_fare := null;
  end if;
  return new;
end;
$$;
revoke all on function vaimoto_private.set_ride_final_fare() from public, anon, authenticated;

drop trigger if exists vaimoto_set_ride_final_fare on public.vaimoto_rides;
create trigger vaimoto_set_ride_final_fare
  before insert or update of status, selected_offer_id, final_fare
  on public.vaimoto_rides
  for each row execute function vaimoto_private.set_ride_final_fare();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vaimoto_rides'::regclass
      and conname = 'vaimoto_rides_final_fare_check'
  ) then
    alter table public.vaimoto_rides
      add constraint vaimoto_rides_final_fare_check
      check (
        (status::text = 'completed' and final_fare is not null and final_fare > 0)
        or (status::text <> 'completed' and final_fare is null)
      );
  end if;
end;
$$;

create index if not exists vaimoto_rides_completed_selected_offer_idx
  on public.vaimoto_rides (completed_at desc, selected_offer_id)
  where status::text = 'completed';
create index if not exists vaimoto_ride_offers_accepted_driver_idx
  on public.vaimoto_ride_offers (driver_id, id)
  where status::text = 'accepted';

create or replace function public.vaimoto_get_my_driver_earnings_summary(
  p_today_start timestamptz,
  p_last_7_days_start timestamptz,
  p_month_start timestamptz
)
returns table (
  today_total numeric,
  last_7_days_total numeric,
  month_total numeric,
  total_earnings numeric,
  completed_rides bigint,
  average_per_ride numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role::text = 'driver'
      and p.driver_approval_status = 'approved'
  ) then
    raise exception 'Only an approved driver can view earnings';
  end if;
  if p_today_start is null or p_last_7_days_start is null or p_month_start is null then
    raise exception 'Earnings date boundaries are required';
  end if;

  return query
  select
    coalesce(sum(r.final_fare) filter (where r.completed_at >= p_today_start), 0)::numeric,
    coalesce(sum(r.final_fare) filter (where r.completed_at >= p_last_7_days_start), 0)::numeric,
    coalesce(sum(r.final_fare) filter (where r.completed_at >= p_month_start), 0)::numeric,
    coalesce(sum(r.final_fare), 0)::numeric,
    count(*)::bigint,
    coalesce(round(avg(r.final_fare), 2), 0)::numeric
  from public.vaimoto_rides r
  join public.vaimoto_ride_offers o
    on o.id = r.selected_offer_id and o.status::text = 'accepted'
  where r.status::text = 'completed'
    and r.final_fare is not null
    and o.driver_id = (select auth.uid());
end;
$$;

create or replace function public.vaimoto_get_my_driver_earnings(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  ride_id uuid,
  completed_at timestamptz,
  pickup_text text,
  destination_text text,
  final_fare numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role::text = 'driver'
      and p.driver_approval_status = 'approved'
  ) then
    raise exception 'Only an approved driver can view earnings';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'The earnings period start must precede its end';
  end if;

  return query
  select r.id, r.completed_at, r.pickup_text, r.destination_text, r.final_fare
  from public.vaimoto_rides r
  join public.vaimoto_ride_offers o
    on o.id = r.selected_offer_id and o.status::text = 'accepted'
  where r.status::text = 'completed'
    and r.final_fare is not null
    and o.driver_id = (select auth.uid())
    and (p_from is null or r.completed_at >= p_from)
    and (p_to is null or r.completed_at < p_to)
  order by r.completed_at desc, r.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 200))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.vaimoto_get_my_driver_earnings_summary(timestamptz, timestamptz, timestamptz) from public, anon;
revoke all on function public.vaimoto_get_my_driver_earnings(timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.vaimoto_get_my_driver_earnings_summary(timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.vaimoto_get_my_driver_earnings(timestamptz, timestamptz, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
