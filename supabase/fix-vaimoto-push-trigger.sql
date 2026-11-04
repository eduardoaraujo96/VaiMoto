-- Repair the VaiMoto push trigger after rotating its exposed webhook secret.
-- Set the same new secret in the Edge Function secrets before running this file.
-- Replace only the placeholder below in the Supabase SQL Editor; never commit the filled value.
begin;

do $$
declare
  webhook_secret text := 'REPLACE_WITH_NEW_RANDOM_SECRET';
  webhook_headers text;
begin
  if webhook_secret ~ '^REPLACE_' or length(webhook_secret) < 32 then
    raise exception 'Replace webhook_secret with the newly rotated secret (at least 32 characters).';
  end if;

  webhook_headers := json_build_object(
    'Content-Type', 'application/json',
    'x-webhook-secret', webhook_secret
  )::text;

  drop trigger if exists vaimoto_send_push_rides on public.vaimoto_rides;

  execute format(
    'create trigger vaimoto_send_push_rides after insert or update on public.vaimoto_rides for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    'https://nnwlugshgwrqmlyatojj.supabase.co/functions/v1/send-push',
    'POST',
    webhook_headers,
    '{}',
    '1000'
  );
end;
$$;

commit;
