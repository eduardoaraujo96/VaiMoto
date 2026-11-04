-- Apply after the existing Supabase schema and role migrations.
begin;

create table if not exists public.push_devices (
  app_role text not null check (app_role in ('customer', 'driver')),
  device_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_role, device_id)
);

create index if not exists push_devices_user_role_idx
  on public.push_devices (user_id, app_role);

alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select, insert, update, delete on public.push_devices to authenticated;

drop policy if exists "push_devices_select_own" on public.push_devices;
create policy "push_devices_select_own" on public.push_devices
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "push_devices_insert_own_role" on public.push_devices;
create policy "push_devices_insert_own_role" on public.push_devices
for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role::text = app_role
  )
);

drop policy if exists "push_devices_update_own_role" on public.push_devices;
create policy "push_devices_update_own_role" on public.push_devices
for update to authenticated using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role::text = app_role
  )
);

drop policy if exists "push_devices_delete_own" on public.push_devices;
create policy "push_devices_delete_own" on public.push_devices
for delete to authenticated using (user_id = (select auth.uid()));

commit;
