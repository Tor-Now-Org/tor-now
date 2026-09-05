-- Invariants that live in the database rather than in application code, proved
-- against a real Postgres. Every statement runs inside one block that ends by
-- raising, so the probe rolls itself back and leaves no rows behind.
--
-- Run with:  psql "$SUPABASE_DB_URL" -f supabase/tests/invariants.sql
-- It succeeds when the final notice reads ALL_INVARIANTS_HELD.
do $$
declare
  v_user uuid; v_biz uuid; v_res uuid; v_svc uuid; v_failed boolean;
begin
  insert into app_user (phone, given_name) values ('+972500000001', 'invariant probe') returning id into v_user;
  insert into business (name, phone) values ('probe business', '+972500000002') returning id into v_biz;
  insert into resource (business_id, name) values (v_biz, 'probe chair') returning id into v_res;
  insert into service (business_id, name, duration_minutes, price_minor)
    values (v_biz, 'probe cut', 30, 8000) returning id into v_svc;

  -- ADR 0003: a confirmed appointment blocks an overlapping one on the same
  -- Resource — and because the stored range includes the Buffer, an
  -- appointment merely touching that Buffer is refused by the same constraint.
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, resource_name,
      price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:00:00Z', '2026-09-01T09:30:00Z',
            '2026-09-01T09:40:00Z', 'probe cut', 'probe chair', 8000, 30, 10);

  v_failed := false;
  begin
    insert into appointment (business_id, resource_id, service_id, customer_id,
        start_at, end_at, occupied_until, service_name, resource_name,
      price_minor, duration_minutes, buffer_minutes)
      values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:35:00Z', '2026-09-01T10:05:00Z',
              '2026-09-01T10:15:00Z', 'probe cut', 'probe chair', 8000, 30, 10);
  exception when exclusion_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'INVARIANT BROKEN: buffer overlap was accepted'; end if;

  -- The half-open range means a booking starting exactly where the previous
  -- Buffer ends is adjacent, not conflicting.
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, resource_name,
      price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:40:00Z', '2026-09-01T10:10:00Z',
            '2026-09-01T10:20:00Z', 'probe cut', 'probe chair', 8000, 30, 10);

  -- ADR 0003: cancelled appointments are excluded by the constraint's
  -- predicate, so a cancelled slot is immediately rebookable.
  update appointment set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'CUSTOMER'
    where resource_id = v_res and start_at = '2026-09-01T09:00:00Z';
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, resource_name,
      price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:00:00Z', '2026-09-01T09:30:00Z',
            '2026-09-01T09:40:00Z', 'probe cut', 'probe chair', 8000, 30, 10);

  -- Removing a calendar must not remove what happened on it: the constraint
  -- refuses, rather than cascading the appointments away.
  v_failed := false;
  begin
    delete from resource where id = v_res;
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'INVARIANT BROKEN: deleting a booked calendar took its appointments';
  end if;

  -- ADR 0006: the audit trail is append-only, enforced rather than intended.
  insert into audit_log (actor_id, action, entity_type, entity_id) values (v_user, 'PROBE', 'Probe', 'x');
  v_failed := false;
  begin
    update audit_log set action = 'TAMPERED' where action = 'PROBE';
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'INVARIANT BROKEN: audit_log was rewritable'; end if;

  -- ADR 0002: a break is the gap between two ranges, so two ranges of one day
  -- that run together describe one range and the table must not hold them.
  -- Without this an editor writing a day twice emptied the day it meant.
  insert into working_hours (resource_id, business_id, day_of_week, start_local, end_local)
    values (v_res, v_biz, 3, 540, 1020);
  v_failed := false;
  begin
    insert into working_hours (resource_id, business_id, day_of_week, start_local, end_local)
      values (v_res, v_biz, 3, 960, 1200);
  exception when exclusion_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'INVARIANT BROKEN: a day was open twice over the same minutes';
  end if;

  -- And two that only touch are two stretches with no break between them,
  -- which is a week the store is expected to hold.
  insert into working_hours (resource_id, business_id, day_of_week, start_local, end_local)
    values (v_res, v_biz, 3, 1020, 1200);

  -- Every Business has a Subscription, without the registration path saying so.
  if not exists (select 1 from subscription where business_id = v_biz) then
    raise exception 'INVARIANT BROKEN: business has no subscription';
  end if;

  -- A Resource may not be borrowed by another Business: the composite foreign
  -- key is what makes ADR 0007's business_id column trustworthy.
  v_failed := false;
  begin
    insert into working_hours (resource_id, business_id, day_of_week, start_local, end_local)
      values (v_res, gen_random_uuid(), 2, 540, 1020);
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'INVARIANT BROKEN: a resource crossed businesses'; end if;

  -- ADR 0014: erasure clears what identifies a person and keeps the row, so
  -- the appointment above still points at it.
  perform app.anonymise_user(v_user);
  if exists (select 1 from app_user where id = v_user and given_name = 'invariant probe') then
    raise exception 'INVARIANT BROKEN: erasure left the name behind';
  end if;
  if not exists (select 1 from app_user where id = v_user and anonymised_at is not null) then
    raise exception 'INVARIANT BROKEN: erasure did not record itself';
  end if;
  if not exists (select 1 from appointment where customer_id = v_user) then
    raise exception 'INVARIANT BROKEN: erasure orphaned an appointment';
  end if;

  -- ADR 0005: a reminder is written once, which is what the stamp is for.
  if exists (
    select 1 from appointment
    where customer_id = v_user and reminder_enqueued_at is not null
  ) then
    raise exception 'INVARIANT BROKEN: a fresh appointment was already reminded';
  end if;

  -- Where scheduled work posts is configuration, not schema. A fresh database
  -- knows the shape of a job and nothing about the deployment it landed in, so
  -- asking for a target before one is set has to fail loudly — a job that
  -- posted to a guessed URL would look like it ran while the outbox quietly
  -- stopped draining.
  if (select api_base_url from app.job_credential where id) is not null then
    raise exception 'INVARIANT BROKEN: a migration decided where jobs post';
  end if;
  v_failed := false;
  begin
    perform app.job_target('outbox');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'INVARIANT BROKEN: job_target invented a URL rather than refusing';
  end if;

  raise exception 'ALL_INVARIANTS_HELD';
end $$;
