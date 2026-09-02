-- app.job_credential was created without row level security, leaving it
-- fully exposed to the anon and authenticated roles. The functions that read
-- it (app.job_secret, app.job_target, app.run_scheduled_job) are all
-- SECURITY DEFINER owned by postgres, so they bypass RLS and are unaffected.
alter table app.job_credential enable row level security;
