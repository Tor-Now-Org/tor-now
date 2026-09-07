-- ---------------------------------------------------------------------------
-- Business team roles (ADR 0016)
--
-- Membership's role vocabulary grows from two values to four. It stays a closed
-- enum on the existing authorization primitive — ADR 0010 rejected a generic
-- permission system, and this is not one.
--
-- A WORKER sees only the Resources assigned to them, which is what
-- membership_resource records. OWNER and MANAGER reach every Resource in their
-- Business implicitly, so they get no rows: nothing to keep in sync when a
-- Resource is added.
-- ---------------------------------------------------------------------------

alter table membership drop constraint membership_role_check;
alter table membership add constraint membership_role_check
  check (role in ('OWNER', 'MANAGER', 'WORKER', 'CUSTOMER'));

-- ADR 0007's composite key, so membership_resource can prove both of its
-- parents agree on the Business without a policy having to join.
alter table membership add constraint membership_business_unique unique (id, business_id);

create table membership_resource (
  id            uuid        primary key default gen_random_uuid(),
  membership_id uuid        not null,
  business_id   uuid        not null,
  resource_id   uuid        not null,
  created_at    timestamptz not null default now(),

  foreign key (membership_id, business_id)
    references membership (id, business_id) on delete cascade,
  foreign key (resource_id, business_id)
    references resource (id, business_id) on delete cascade,
  unique (membership_id, resource_id)
);

create index membership_resource_by_membership on membership_resource (membership_id);
create index membership_resource_by_resource on membership_resource (resource_id);

comment on table membership_resource is
  'Which Resources a WORKER may see. OWNER and MANAGER have every Resource implicitly and are never listed here.';
