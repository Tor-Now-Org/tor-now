-- `app.run_scheduled_job` had the project's own API URL written into its body,
-- which made the function a copy of one deployment rather than a description of
-- what scheduled work does. Moving the database to another region proved the
-- point: every job kept calling the region we had just left.
--
-- The URL joins the secret in `app.job_credential`, which is already the one
-- place a job's credentials live and is already unreachable from any client
-- role. Both halves of "how a job reaches the API" are now configuration, set
-- once per deployment, and neither is in a migration.
alter table app.job_credential
  add column if not exists api_base_url text;

comment on column app.job_credential.api_base_url is
  'Where scheduled work posts, e.g. https://<ref>.supabase.co/functions/v1/api. Set per deployment; there is no sensible default.';

create or replace function app.job_target(job_path text)
returns text
language plpgsql
stable
security definer
set search_path = app, pg_temp
as $$
declare
  base text;
begin
  select api_base_url into base from app.job_credential where id;
  if base is null or btrim(base) = '' then
    -- Loud rather than silent: a job posting to a guessed URL would look like
    -- it ran, and the outbox would quietly stop draining.
    raise exception
      'app.job_credential.api_base_url is not set; scheduled work has nowhere to post';
  end if;
  return rtrim(base, '/') || '/jobs/' || job_path;
end;
$$;

revoke all on function app.job_target(text) from public, anon, authenticated;

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
    app.job_target(job_path),
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
