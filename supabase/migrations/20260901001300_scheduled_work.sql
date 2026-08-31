-- ADR 0007: "Scheduled work — draining the notification outbox, audit retention
-- — is driven by Supabase Cron, since serverless functions do not run
-- unprompted."
--
-- The jobs call the Edge Function rather than doing the work in SQL, because
-- ADR 0006 makes "every write goes through a decorated repository" a standing
-- constraint: a cron job reaching into the tables directly would be exactly the
-- ad-hoc script the ADR warns produces no audit trail.
--
-- That means cron has to authenticate. It gets its own credential rather than
-- borrowing the service role key: the secret is generated here, never leaves
-- the database, and is read by both sides from the same place — so there is no
-- value for an operator to copy, paste or leak.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists app.job_credential (
  id      boolean primary key default true check (id),
  secret  text    not null,
  created_at timestamptz not null default now()
);

comment on table app.job_credential is
  'The single credential scheduled work presents to the API. One row, enforced by the primary key.';

insert into app.job_credential (secret)
values (encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

create or replace function app.job_secret()
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select secret from app.job_credential where id;
$$;

revoke all on function app.job_secret() from public, anon, authenticated;

create or replace function app.run_scheduled_job(job_path text)
returns bigint
language sql
security definer
set search_path = app, net, pg_temp
as $$
  select net.http_post(
    url := 'https://boiqhhckvypicjfpeuem.supabase.co/functions/v1/api/jobs/' || job_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || app.job_secret()
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$;

revoke all on function app.run_scheduled_job(text) from public, anon, authenticated;

select cron.schedule(
  'drain-notification-outbox',
  '* * * * *',
  $$select app.run_scheduled_job('outbox')$$
);

select cron.schedule(
  'prune-audit-log',
  '30 3 * * *',
  $$select app.run_scheduled_job('audit-retention')$$
);

select cron.schedule(
  'deactivate-lapsed-businesses',
  '0 4 * * *',
  $$select app.run_scheduled_job('billing-deactivation')$$
);
