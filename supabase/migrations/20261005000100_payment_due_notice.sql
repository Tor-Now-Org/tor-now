-- A Business opened with no Trial — its owner had theirs — owes from its first
-- day, and the nightly run turns it off unless paid by then. Its owner is told
-- so the moment it opens, in the transaction that opens it.

drop policy notice_written_for_own_act on notice;
create policy notice_written_for_own_act on notice
  for insert to authenticated
  with check (
    app.owns(business_id)
    and kind in (
      'TRIAL_STARTED', 'PAYMENT_DUE', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'CALENDARS_RESUMED',
      'ADDON_ADDED', 'ADDON_CANCELLED', 'ADDON_INCLUDED'
    )
  );

alter table notice drop constraint notice_kind_check;
alter table notice add constraint notice_kind_check check (kind in (
  'TRIAL_STARTED', 'TRIAL_ENDING', 'PAYMENT_LATE', 'PAYMENT_DUE', 'DEACTIVATED',
  'PAYMENT_RECORDED', 'PLAN_CHANGED', 'MOVE_SCHEDULED', 'MOVE_SOON',
  'MOVE_APPLIED', 'CALENDARS_PAUSED', 'CALENDARS_RESUMED',
  'FEATURES_GRANTED', 'GRANT_EXTENDED', 'GRANT_ENDING', 'GRANT_ENDED',
  'EDITION_ANNOUNCED', 'EDITION_SOON', 'EDITION_APPLIED', 'EDITION_CANCELLED',
  'PLAN_IMPROVED',
  'PREVIEW_STARTED', 'PREVIEW_EXTENDED', 'PREVIEW_KEPT', 'PREVIEW_LEAVING', 'PREVIEW_ENDING',
  'ADDON_OFFERED', 'ADDON_ADDED', 'ADDON_CANCELLED', 'ADDON_PRICE_RISING', 'ADDON_PRICE_SOON',
  'ADDON_RISE_CANCELLED', 'ADDON_PRICE_LOWERED', 'ADDON_INCLUDED'
));
