-- ---------------------------------------------------------------------------
-- The Catalogue editor, first part (ADR 0021): administrators correct Unit
-- Rates and give Businesses Grants. Both tables exist already; what changes is
-- what an owner is told about Grants, and when a rate was last entered.
-- ---------------------------------------------------------------------------

-- A Grant is news to the owner: given, extended, about to end, ended early.
alter table notice drop constraint notice_kind_check;
alter table notice add constraint notice_kind_check check (kind in (
  'TRIAL_STARTED', 'TRIAL_ENDING', 'PAYMENT_LATE', 'DEACTIVATED',
  'PAYMENT_RECORDED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'MOVE_SOON',
  'MOVE_APPLIED', 'CALENDARS_PAUSED', 'CALENDARS_RESUMED',
  'FEATURES_GRANTED', 'GRANT_EXTENDED', 'GRANT_ENDING', 'GRANT_ENDED'
));

-- A rate entered again for the same unit and day replaces the figure; this
-- says when it was last entered, beside who checked it.
alter table unit_rate add column entered_at timestamptz not null default now();

comment on column unit_rate.entered_at is
  'When this figure was last entered. The audit log keeps every earlier one.';

-- Notices told in one act — a payment, and the banners it ends — share a
-- transaction, where now() is one instant for all of them. The clock's own
-- time keeps them in the order they were told.
alter table notice alter column created_at set default clock_timestamp();
