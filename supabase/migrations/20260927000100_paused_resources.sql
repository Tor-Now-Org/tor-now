-- ---------------------------------------------------------------------------
-- Paused Resources (CONTEXT.md): a calendar taken out of booking because its
-- Business holds more than its Resource Allowance — after a move from Team to
-- Solo, say. It keeps its hours, blocks and every appointment, upcoming ones
-- included, and comes back as it was once the Allowance covers it again.
--
-- A column rather than a reuse of `active`: `active` is the owner's own
-- decision to hide or remove a calendar, and a pause is the platform's, lifted
-- by the platform. Folding the two together would make an upgrade resurrect
-- calendars the owner had hidden on purpose.
-- ---------------------------------------------------------------------------

alter table resource add column paused_at timestamptz;

comment on column resource.paused_at is
  'Set while the Business is over its Resource Allowance; null when bookable.';
