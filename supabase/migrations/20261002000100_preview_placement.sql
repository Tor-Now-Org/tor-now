-- ---------------------------------------------------------------------------
-- Previews, managed (ADR 0020, ADR 0021): an administrator starts one, extends
-- it, and decides which Plans keep its Feature when it ends. The Plans that do
-- not keep it are told thirty days ahead; a Preview nobody decided on is
-- carried further by the daily run rather than ending unannounced.
-- ---------------------------------------------------------------------------

alter table feature_preview
  -- The Plans that keep the Feature when the Preview ends; null while undecided.
  add column keep_on text[],
  add column decided_at timestamptz,
  add constraint feature_preview_keep_on_plans
    check (keep_on is null or keep_on <@ array['SOLO', 'TEAM']::text[]);

comment on column feature_preview.keep_on is
  'The Plans that keep the Feature when the Preview ends; null while undecided.';

alter table notice drop constraint notice_kind_check;
alter table notice add constraint notice_kind_check check (kind in (
  'TRIAL_STARTED', 'TRIAL_ENDING', 'PAYMENT_LATE', 'DEACTIVATED',
  'PAYMENT_RECORDED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'MOVE_SOON',
  'MOVE_APPLIED', 'CALENDARS_PAUSED', 'CALENDARS_RESUMED',
  'FEATURES_GRANTED', 'GRANT_EXTENDED', 'GRANT_ENDING', 'GRANT_ENDED',
  'EDITION_ANNOUNCED', 'EDITION_SOON', 'EDITION_APPLIED', 'EDITION_CANCELLED',
  'PLAN_IMPROVED',
  'PREVIEW_STARTED', 'PREVIEW_EXTENDED', 'PREVIEW_KEPT', 'PREVIEW_LEAVING', 'PREVIEW_ENDING'
));
