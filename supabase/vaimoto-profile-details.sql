-- Adds isolated VaiMoto driver/profile fields to an existing Supabase project.
-- Does not modify FlashTaxi profile, vehicle, ride, or bid data.
begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Required table public.profiles does not exist.';
  end if;
end;
$$;

create table if not exists public.vaimoto_profile_details (
  id uuid primary key references public.profiles(id) on delete cascade,
  username text,
  avatar_path text,
  vehicle_type text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_color text,
  vehicle_plate text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vaimoto_profile_details
  add column if not exists username text,
  add column if not exists avatar_path text,
  add column if not exists vehicle_type text,
  add column if not exists vehicle_brand text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_color text,
  add column if not exists vehicle_plate text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.vaimoto_profile_details'::regclass and conname = 'vaimoto_profile_details_username_check') then
    alter table public.vaimoto_profile_details add constraint vaimoto_profile_details_username_check
      check (username is null or username ~ '^[a-z0-9._]{3,24}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.vaimoto_profile_details'::regclass and conname = 'vaimoto_profile_details_vehicle_type_check') then
    alter table public.vaimoto_profile_details add constraint vaimoto_profile_details_vehicle_type_check
      check (vehicle_type is null or vehicle_type in ('motorcycle', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.vaimoto_profile_details'::regclass and conname = 'vaimoto_profile_details_vehicle_color_check') then
    alter table public.vaimoto_profile_details add constraint vaimoto_profile_details_vehicle_color_check
      check (vehicle_color is null or char_length(trim(vehicle_color)) between 2 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.vaimoto_profile_details'::regclass and conname = 'vaimoto_profile_details_vehicle_brand_check') then
    alter table public.vaimoto_profile_details add constraint vaimoto_profile_details_vehicle_brand_check
      check (vehicle_brand is null or char_length(vehicle_brand) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.vaimoto_profile_details'::regclass and conname = 'vaimoto_profile_details_vehicle_model_check') then
    alter table public.vaimoto_profile_details add constraint vaimoto_profile_details_vehicle_model_check
      check (vehicle_model is null or char_length(vehicle_model) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.vaimoto_profile_details'::regclass and conname = 'vaimoto_profile_details_vehicle_plate_check') then
    alter table public.vaimoto_profile_details add constraint vaimoto_profile_details_vehicle_plate_check
      check (vehicle_plate is null or vehicle_plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
  end if;
end;
$$;

create unique index if not exists vaimoto_profile_details_username_unique_idx
  on public.vaimoto_profile_details (lower(username))
  where username is not null;

alter table public.vaimoto_profile_details enable row level security;

drop policy if exists vaimoto_profile_details_select_own on public.vaimoto_profile_details;
create policy vaimoto_profile_details_select_own
  on public.vaimoto_profile_details
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists vaimoto_profile_details_insert_own on public.vaimoto_profile_details;
create policy vaimoto_profile_details_insert_own
  on public.vaimoto_profile_details
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists vaimoto_profile_details_update_own on public.vaimoto_profile_details;
create policy vaimoto_profile_details_update_own
  on public.vaimoto_profile_details
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select, insert, update on public.vaimoto_profile_details to authenticated;

notify pgrst, 'reload schema';

commit;
