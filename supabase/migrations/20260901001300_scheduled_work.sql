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
-- pg_cron and pg_net are Supabase platform extensions. Everything below is
-- deployment configuration rather than schema, so on a plain Postgres — a CI
-- service container, or a developer's laptop — this migration says so and
-- stops, leaving the schema identical either way.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net unavailable: skipping scheduled work setup';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';
end $$;

create table if not exists app.job_credential (
  id      boolean primary key default true check (id),
  secret  text    not null,
  created_at timestamptz not null default now()
);

comment on table app.job_credential is
  'The single credential scheduled work presents to the API. One row, enforced by the primary key.';

insert into app.job_credential (secret)
-- Unqualified: pgcrypto sits in `extensions` on Supabase and in `public`
-- on a plain Postgres, and both are on the search path of the role applying
-- this migration.
values (encode(gen_random_bytes(32), 'hex'))
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

-- Defined only where pg_net is, since it calls net.http_post by name.
create or replace function app.run_scheduled_job(job_path text)
returns bigint
language plpgsql
security definer
set search_path = app, net, pg_temp
as $$
declare
  request_id bigint;
begin
  -- Late-bound so the function can exist on a Postgres without pg_net; calling
  -- it there fails loudly rather than the migration failing to apply.
  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb,'
    || ' timeout_milliseconds := 20000)',
    'https://boiqhhckvypicjfpeuem.supabase.co/functions/v1/api/jobs/' || job_path,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || app.job_secret()
    ),
    '{}'::jsonb
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function app.run_scheduled_job(text) from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron unavailable: no jobs scheduled';
    return;
  end if;

  perform cron.schedule(
    'drain-notification-outbox', '* * * * *',
    $job$select app.run_scheduled_job('outbox')$job$);
  perform cron.schedule(
    'prune-audit-log', '30 3 * * *',
    $job$select app.run_scheduled_job('audit-retention')$job$);
  perform cron.schedule(
    'deactivate-lapsed-businesses', '0 4 * * *',
    $job$select app.run_scheduled_job('billing-deactivation')$job$);
  -- ADR 0005's reminders, hourly against a wider window so a skipped run still
  -- catches its appointments; the enqueued stamp stops the overlap duplicating.
  perform cron.schedule(
    'send-appointment-reminders', '15 * * * *',
    $job$select app.run_scheduled_job('reminders')$job$);
end $$;
