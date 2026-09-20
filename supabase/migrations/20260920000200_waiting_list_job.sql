-- ---------------------------------------------------------------------------
-- The waiting-list job
--
-- Drains the marks left by anything that changed what a Resource has on a
-- date, and tells whoever was waiting for what the day is now offering.
--
-- Every two minutes. A freed hour is worth telling people about quickly —
-- somebody cancelling at short notice is exactly the gap this exists to fill —
-- and the work is proportional to how much changed rather than to how many
-- people are waiting, so a run with nothing to do costs one empty query.
--
-- Safe to run at any time and as often as anyone likes: the outbox rows and
-- the stamp that says they were written commit together, so a second run has
-- nothing new to say. See docs/adr/0018-waiting-list.md.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron unavailable: waiting-list job not scheduled';
    return;
  end if;

  perform cron.schedule(
    'publish-waiting-list-openings', '*/2 * * * *',
    $job$select app.run_scheduled_job('waiting-list')$job$);
end $$;
