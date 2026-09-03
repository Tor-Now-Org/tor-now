-- ---------------------------------------------------------------------------
-- Blocking a customer. A Block is per-Business, like the Membership it lives
-- on: the same person may be blocked by one Business and welcome at another.
-- A nullable timestamp rather than a boolean, so the record says when.
-- ---------------------------------------------------------------------------

alter table membership add column blocked_at timestamptz;

comment on column membership.blocked_at is
  'When the owner blocked this customer from booking. Null means active.';

-- The first update policy on membership. The rule it relaxes was "a role is
-- granted or removed, never edited in place"; blocking edits neither the role
-- nor the pair, and an owner who may delete the row outright gains nothing
-- here they did not already have.
create policy membership_blocked_by_owner on membership
  for update to authenticated
  using (app.owns(business_id))
  with check (app.owns(business_id));
