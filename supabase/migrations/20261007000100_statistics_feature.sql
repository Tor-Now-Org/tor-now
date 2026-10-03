-- ---------------------------------------------------------------------------
-- STATISTICS joins the closed list of Features (packages/domain
-- billing/feature.ts): a Business's month in numbers, for its owner.
--
-- Placed nowhere here. Which Plans include it is Catalogue data an
-- administrator edits (ADR 0019, 0021), and adding it to a Plan is a change
-- that adds value, applied at once and announced by Notice (ADR 0020).
-- ---------------------------------------------------------------------------

create or replace function app.is_feature(value text)
returns boolean
language sql
immutable
as $$
  select value in ('REMINDERS', 'CUSTOMER_HISTORY', 'TEAM_ROLES', 'WAITING_LIST', 'STATISTICS');
$$;
