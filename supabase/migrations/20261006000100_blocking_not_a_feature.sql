-- ---------------------------------------------------------------------------
-- Blocking a customer is part of the product, not a Feature: every Business may
-- block, on every Plan. CUSTOMER_BLOCKING leaves the closed list in code
-- (packages/domain billing/feature.ts), so nothing may still name it here —
-- every row that does is read through parseFeature and would refuse.
-- ---------------------------------------------------------------------------

update plan_version set features = array_remove(features, 'CUSTOMER_BLOCKING')
where 'CUSTOMER_BLOCKING' = any (features);

delete from feature_preview where feature = 'CUSTOMER_BLOCKING';
delete from feature_grant where feature = 'CUSTOMER_BLOCKING';
delete from days_owed where kind = 'ADDON_DAYS' and subject = 'CUSTOMER_BLOCKING';
delete from addon_holding where feature = 'CUSTOMER_BLOCKING';
delete from addon_offer where feature = 'CUSTOMER_BLOCKING';
delete from usage_record where source = 'CUSTOMER_BLOCKING';

-- Notices about it alone go; lists that named it among others drop it.
delete from notice where facts ->> 'feature' = 'CUSTOMER_BLOCKING';

update notice
set facts = jsonb_set(facts, '{features}', coalesce(
  (select jsonb_agg(item) from jsonb_array_elements(facts -> 'features') as item where item <> '"CUSTOMER_BLOCKING"'),
  '[]'::jsonb
))
where facts -> 'features' ? 'CUSTOMER_BLOCKING';

update notice
set facts = jsonb_set(facts, '{gained}', coalesce(
  (select jsonb_agg(item) from jsonb_array_elements(facts -> 'gained') as item where item <> '"CUSTOMER_BLOCKING"'),
  '[]'::jsonb
))
where facts -> 'gained' ? 'CUSTOMER_BLOCKING';

update notice
set facts = jsonb_set(facts, '{lost}', coalesce(
  (select jsonb_agg(item) from jsonb_array_elements(facts -> 'lost') as item where item <> '"CUSTOMER_BLOCKING"'),
  '[]'::jsonb
))
where facts -> 'lost' ? 'CUSTOMER_BLOCKING';

-- A Notice that granted, or warned of the end of, only this now says nothing.
delete from notice where kind in ('FEATURES_GRANTED', 'GRANT_ENDING') and facts -> 'features' = '[]'::jsonb;

create or replace function app.is_feature(value text)
returns boolean
language sql
immutable
as $$
  select value in ('REMINDERS', 'CUSTOMER_HISTORY', 'TEAM_ROLES', 'WAITING_LIST');
$$;
