-- ---------------------------------------------------------------------------
-- Fix: Allow business owners/managers to look up any user by phone
--
-- ADR 0016 allows inviting by phone, but the user may have already signed
-- up elsewhere without a membership at this business. The lookup endpoint
-- needs to find those users.
--
-- Solution: Allow managers to read any app_user row, not just those with
-- existing memberships at their business.
-- ---------------------------------------------------------------------------

drop policy app_user_readable on app_user;
create policy app_user_readable on app_user
  for select to authenticated
  using (
    id = app.current_user_id()
    or exists (
      select 1 from membership
      where membership.user_id = app_user.id
        and app.manages(membership.business_id)
    )
    or exists (
      select 1 from membership
      where user_id = app.current_user_id()
        and role in ('OWNER', 'MANAGER')
    )
  );