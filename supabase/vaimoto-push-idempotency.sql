-- Stores one idempotency key per newly-created ride push event.
begin;

create table if not exists public.vaimoto_push_events (
  event_key text primary key,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.vaimoto_push_events enable row level security;
revoke all on public.vaimoto_push_events from public, anon, authenticated;
grant all on public.vaimoto_push_events to service_role;

commit;
