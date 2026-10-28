-- Apply after schema.sql; for an existing installation, apply this before realtime-flow.sql.
-- New and existing drivers remain pending until reviewed by a trusted operator.
begin;

alter table public.profiles
  add column if not exists driver_approval_status text not null default 'pending';

update public.profiles
set driver_approval_status = 'pending'
where driver_approval_status is null;

alter table public.profiles
  alter column driver_approval_status set default 'pending',
  alter column driver_approval_status set not null;

update public.driver_locations dl
set is_available = false
from public.profiles p
where p.id = dl.driver_id
  and p.role = 'driver'
  and p.driver_approval_status <> 'approved'
  and dl.is_available = true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_driver_approval_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_driver_approval_status_check
      check (driver_approval_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

drop policy if exists "profiles_insert_self" on public.profiles;

create or replace function public.prevent_profile_privilege_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role
      or new.driver_approval_status is distinct from old.driver_approval_status)
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Profile role and driver approval cannot be changed by the account owner';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_change on public.profiles;
drop trigger if exists profiles_prevent_privilege_change on public.profiles;
create trigger profiles_prevent_privilege_change
before update on public.profiles
for each row execute procedure public.prevent_profile_privilege_change();

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

drop policy if exists "locations_insert_self_driver" on public.driver_locations;
create policy "locations_insert_self_driver" on public.driver_locations
for insert to authenticated with check (
  driver_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'driver'
      and p.driver_approval_status = 'approved'
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
  )
);

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
    select 1 from public.rides r
    where r.id = ride_id
      and r.status = 'searching'
      and r.expires_at > now()
  )
  and exists (
    select 1 from public.driver_locations dl
    where dl.driver_id = (select auth.uid())
      and dl.is_available = true
  )
);

create or replace view public.driver_public_profiles with (security_barrier = true) as
  select id, full_name, avatar_url
  from public.profiles
  where role = 'driver' and driver_approval_status = 'approved';
grant select on public.driver_public_profiles to authenticated;

commit;
