-- cron.sql — run MANUALLY once after the app is deployed (Supabase SQL editor).
--
-- Prerequisites: enable `pg_cron` and `pg_net` (Dashboard -> Integrations) and
-- run migrations/0001_init.sql.
--
-- BEFORE RUNNING, replace the two placeholders in the DO block below:
--   <APP_URL>      full endpoint, e.g. https://my-app.vercel.app/api/cron/sync
--   <CRON_SECRET>  same value as the CRON_SECRET env var on Vercel
-- Do not commit the filled-in file. Re-running is safe (idempotent): Vault
-- secrets are updated in place and the job is unscheduled before rescheduling.
--
-- Verify:
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select id, status_code, error_msg, created from net._http_response order by created desc limit 10;
-- Vercel Deployment Protection must not block the production domain.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_url    text := '<APP_URL>';
  v_secret text := '<CRON_SECRET>';
  v_id     uuid;
begin
  if v_url like '%<%' or v_secret like '%<%' then
    raise exception 'Replace the <APP_URL> and <CRON_SECRET> placeholders before running cron.sql';
  end if;

  select id into v_id from vault.secrets where name = 'changelog_sync_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'changelog_sync_url', 'Shopify changelog sync endpoint');
  else
    perform vault.update_secret(v_id, v_url);
  end if;

  select id into v_id from vault.secrets where name = 'changelog_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'changelog_cron_secret', 'Bearer token for the sync endpoint');
  else
    perform vault.update_secret(v_id, v_secret);
  end if;

  if exists (select 1 from cron.job where jobname = 'shopify-changelog-sync') then
    perform cron.unschedule('shopify-changelog-sync');
  end if;
end;
$$;

select cron.schedule(
  'shopify-changelog-sync',
  '*/15 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'changelog_sync_url'),
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'changelog_cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $job$
);
