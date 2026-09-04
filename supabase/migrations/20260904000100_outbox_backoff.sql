-- A failed message waits before it is tried again.
--
-- The worker put a failure straight back to PENDING, and the cron drains every
-- minute, so a provider that was rate limiting or down was hit five times in
-- five minutes and then given up on. That is the wrong shape twice over: it
-- spends a paid message allowance on an outage, and it abandons a message
-- inside five minutes of a problem that usually clears in more.
--
-- Nullable rather than defaulted to now(): a row that has never failed has no
-- retry time, and saying so with NULL keeps "not yet attempted" distinct from
-- "attempted and due immediately".
alter table notification_outbox
  add column if not exists retry_after timestamptz;

comment on column notification_outbox.retry_after is
  'When a failed message may next be attempted. NULL for one that has not failed.';

-- The claim query reads exactly this: pending, and due. Rows waiting out a
-- backoff are skipped by the index rather than fetched and filtered.
drop index if exists notification_outbox_pending;
create index notification_outbox_pending
  on notification_outbox (retry_after nulls first, created_at)
  where status = 'PENDING';
