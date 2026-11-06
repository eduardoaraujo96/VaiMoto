-- Secure ride-scoped chat for VaiMoto's isolated rides schema.
begin;

do $$
begin
  if to_regclass('public.vaimoto_rides') is null
     or to_regclass('public.vaimoto_ride_offers') is null then
    raise exception 'Apply the VaiMoto isolated ride schema before this chat migration.';
  end if;
end;
$$;

create schema if not exists vaimoto_private;
revoke all on schema vaimoto_private from public, anon;
grant usage on schema vaimoto_private to authenticated;

create or replace function vaimoto_private.can_access_ride_chat(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.vaimoto_rides r
    left join public.vaimoto_ride_offers accepted
      on accepted.id = r.selected_offer_id and accepted.status::text = 'accepted'
    where r.id = p_ride_id
      and (
        r.customer_id = (select auth.uid())
        or accepted.driver_id = (select auth.uid())
      )
  );
$$;

revoke all on function vaimoto_private.can_access_ride_chat(uuid) from public, anon;
grant execute on function vaimoto_private.can_access_ride_chat(uuid) to authenticated;

create or replace function vaimoto_private.can_send_ride_chat(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select vaimoto_private.can_access_ride_chat(p_ride_id) and exists (
    select 1 from public.vaimoto_rides r
    where r.id = p_ride_id and r.status::text in ('confirmed', 'in_progress')
  );
$$;

revoke all on function vaimoto_private.can_send_ride_chat(uuid) from public, anon;
grant execute on function vaimoto_private.can_send_ride_chat(uuid) to authenticated;

create table if not exists public.vaimoto_ride_chat_messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.vaimoto_rides(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists vaimoto_ride_chat_messages_ride_created_idx
  on public.vaimoto_ride_chat_messages (ride_id, created_at, id);
create index if not exists vaimoto_ride_chat_messages_unread_idx
  on public.vaimoto_ride_chat_messages (ride_id, sender_id, created_at);

alter table public.vaimoto_ride_chat_messages enable row level security;
revoke all on public.vaimoto_ride_chat_messages from anon, authenticated;
grant select, insert on public.vaimoto_ride_chat_messages to authenticated;

drop policy if exists vaimoto_ride_chat_messages_select_participant on public.vaimoto_ride_chat_messages;
create policy vaimoto_ride_chat_messages_select_participant
  on public.vaimoto_ride_chat_messages
  for select to authenticated
  using (vaimoto_private.can_access_ride_chat(ride_id));

drop policy if exists vaimoto_ride_chat_messages_insert_active_participant on public.vaimoto_ride_chat_messages;
create policy vaimoto_ride_chat_messages_insert_active_participant
  on public.vaimoto_ride_chat_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and vaimoto_private.can_send_ride_chat(ride_id)
  );

create table if not exists public.vaimoto_ride_chat_reads (
  ride_id uuid not null references public.vaimoto_rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default clock_timestamp(),
  primary key (ride_id, user_id)
);

alter table public.vaimoto_ride_chat_reads enable row level security;
revoke all on public.vaimoto_ride_chat_reads from public, anon, authenticated;

create or replace function public.vaimoto_mark_ride_chat_read(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not vaimoto_private.can_access_ride_chat(p_ride_id) then
    raise exception 'Only a ride participant can mark this conversation as read';
  end if;

  insert into public.vaimoto_ride_chat_reads (ride_id, user_id, last_read_at)
  values (p_ride_id, v_user_id, clock_timestamp())
  on conflict (ride_id, user_id)
  do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.vaimoto_get_ride_chat_unread_count(p_ride_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_last_read_at timestamptz;
  v_unread_count bigint;
begin
  if v_user_id is null or not vaimoto_private.can_access_ride_chat(p_ride_id) then
    raise exception 'Only a ride participant can view this conversation';
  end if;

  select last_read_at into v_last_read_at
  from public.vaimoto_ride_chat_reads
  where ride_id = p_ride_id and user_id = v_user_id;

  select count(*) into v_unread_count
  from public.vaimoto_ride_chat_messages m
  where m.ride_id = p_ride_id
    and m.sender_id <> v_user_id
    and (v_last_read_at is null or m.created_at > v_last_read_at);
  return v_unread_count;
end;
$$;

revoke all on function public.vaimoto_mark_ride_chat_read(uuid) from public, anon;
revoke all on function public.vaimoto_get_ride_chat_unread_count(uuid) from public, anon;
grant execute on function public.vaimoto_mark_ride_chat_read(uuid) to authenticated;
grant execute on function public.vaimoto_get_ride_chat_unread_count(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vaimoto_ride_chat_messages'
  ) then
    alter publication supabase_realtime add table public.vaimoto_ride_chat_messages;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
