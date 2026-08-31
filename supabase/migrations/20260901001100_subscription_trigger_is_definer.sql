-- "Every Business has a Subscription" is an invariant of the platform, not
-- something the registering owner does — and `subscription` deliberately has no
-- insert policy, because an owner must not be able to write their own billing
-- terms. Without SECURITY DEFINER the trigger runs as the registering user and
-- is refused by the very policy that protects the table.
create or replace function app.create_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into subscription (business_id) values (new.id);
  return new;
end;
$$;
