-- VaiMoto: schema inicial Supabase/PostgreSQL.
-- Execute no SQL Editor de um projeto Supabase novo. Revise antes de produção.
create extension if not exists pgcrypto;

create type public.user_role as enum ('customer', 'driver');
create type public.ride_status as enum ('searching', 'offered', 'confirmed', 'in_progress', 'completed', 'cancelled', 'expired');
create type public.offer_status as enum ('pending', 'accepted', 'rejected', 'expired', 'withdrawn');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'customer',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  pickup_text text not null check (char_length(trim(pickup_text)) between 2 and 300),
  destination_text text not null check (char_length(trim(destination_text)) between 2 and 300),
  status public.ride_status not null default 'searching',
  selected_offer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

create table public.driver_locations (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  is_available boolean not null default false,
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint valid_latitude check (latitude is null or latitude between -90 and 90),
  constraint valid_longitude check (longitude is null or longitude between -180 and 180)
);

create table public.ride_offers (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete restrict,
  price numeric(10,2) not null check (price > 0 and price <= 10000),
  eta_minutes integer not null check (eta_minutes between 1 and 180),
  status public.offer_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  unique (ride_id, driver_id)
);

alter table public.rides add constraint rides_selected_offer_fk foreign key (selected_offer_id) references public.ride_offers(id) on delete set null;
create index rides_customer_created_idx on public.rides(customer_id, created_at desc);
create index rides_status_created_idx on public.rides(status, created_at desc);
create index offers_ride_created_idx on public.ride_offers(ride_id, created_at desc);
create index offers_driver_created_idx on public.ride_offers(driver_id, created_at desc);

-- Profile created automatically. Role is limited to the two public app roles.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'driver' then 'driver'::public.user_role else 'customer'::public.user_role end
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute procedure public.touch_updated_at();
create trigger rides_touch_updated_at before update on public.rides for each row execute procedure public.touch_updated_at();
create trigger locations_touch_updated_at before update on public.driver_locations for each row execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.rides enable row level security;
alter table public.driver_locations enable row level security;
alter table public.ride_offers enable row level security;

-- Profiles: user sees own profile; authenticated users may read limited public driver profile data.
create policy "profiles_select_self" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles_insert_self" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Prevent a user from promoting/demoting their own account by editing role.
create or replace function public.prevent_profile_role_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    raise exception 'Profile role cannot be changed directly';
  end if;
  return new;
end;
$$;
create trigger profiles_prevent_role_change before update on public.profiles
for each row execute procedure public.prevent_profile_role_change();

-- A narrow public view exposes only non-sensitive fields for driver cards.
-- The view owner can read through RLS; do not add phone or private fields here.
create or replace view public.driver_public_profiles with (security_barrier = true) as
  select id, full_name, avatar_url from public.profiles where role = 'driver';
grant select on public.driver_public_profiles to authenticated;

-- Rides: customers manage their own requests; drivers can see open requests only.
create policy "rides_customer_select_own" on public.rides for select to authenticated using (customer_id = (select auth.uid()));
create policy "rides_driver_select_searching" on public.rides for select to authenticated using (
  status = 'searching' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'driver')
);
create policy "rides_customer_insert_own" on public.rides for insert to authenticated with check (
  customer_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'customer')
);
create policy "rides_customer_update_own_searching" on public.rides for update to authenticated using (
  customer_id = (select auth.uid()) and status in ('searching','offered')
) with check (customer_id = (select auth.uid()));

-- Driver location: each driver manages their own availability/location. Customers can see available drivers.
create policy "locations_select_available" on public.driver_locations for select to authenticated using (is_available = true or driver_id = (select auth.uid()));
create policy "locations_insert_self_driver" on public.driver_locations for insert to authenticated with check (
  driver_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'driver')
);
create policy "locations_update_self_driver" on public.driver_locations for update to authenticated using (driver_id = (select auth.uid())) with check (
  driver_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'driver')
);

-- CRITICAL PRIVACY: driver sees only their own offers; customer sees offers for their own rides.
create policy "offers_select_own_driver_or_customer" on public.ride_offers for select to authenticated using (
  driver_id = (select auth.uid()) or exists (select 1 from public.rides r where r.id = ride_id and r.customer_id = (select auth.uid()))
);
create policy "offers_insert_driver_own" on public.ride_offers for insert to authenticated with check (
  driver_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'driver')
  and exists (select 1 from public.rides r where r.id = ride_id and r.status in ('searching','offered'))
);
create policy "offers_driver_update_own_pending" on public.ride_offers for update to authenticated using (
  driver_id = (select auth.uid()) and status = 'pending'
) with check (driver_id = (select auth.uid()));

-- IMPORTANT before production:
-- 1) Role updates are blocked by a trigger; the public driver view exposes only non-sensitive fields.
-- 2) Review the public view and trigger under your Supabase project owner and test with separate accounts.
-- 3) Move ride confirmation/status transitions to a SECURITY DEFINER RPC with authorization and row locks.
-- 4) Validate the 3-nearest-driver dispatch and 30-second expansion on server-side jobs/functions.
-- 5) Test all RLS policies using separate customer/driver accounts. Never expose service_role key in browser.
