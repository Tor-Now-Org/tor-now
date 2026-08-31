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
  insert into app_user (phone, name) values ('+972500000001', 'invariant probe') returning id into v_user;
  insert into business (name, phone) values ('probe business', '+972500000002') returning id into v_biz;
  insert into resource (business_id, name) values (v_biz, 'probe chair') returning id into v_res;
  insert into service (business_id, name, duration_minutes, price_minor)
    values (v_biz, 'probe cut', 30, 8000) returning id into v_svc;

  -- ADR 0003: a confirmed appointment blocks an overlapping one on the same
  -- Resource — and because the stored range includes the Buffer, an
  -- appointment merely touching that Buffer is refused by the same constraint.
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:00:00Z', '2026-09-01T09:30:00Z',
            '2026-09-01T09:40:00Z', 'probe cut', 8000, 30, 10);

  v_failed := false;
  begin
    insert into appointment (business_id, resource_id, service_id, customer_id,
        start_at, end_at, occupied_until, service_name, price_minor, duration_minutes, buffer_minutes)
      values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:35:00Z', '2026-09-01T10:05:00Z',
              '2026-09-01T10:15:00Z', 'probe cut', 8000, 30, 10);
  exception when exclusion_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'INVARIANT BROKEN: buffer overlap was accepted'; end if;

  -- The half-open range means a booking starting exactly where the previous
  -- Buffer ends is adjacent, not conflicting.
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:40:00Z', '2026-09-01T10:10:00Z',
            '2026-09-01T10:20:00Z', 'probe cut', 8000, 30, 10);

  -- ADR 0003: cancelled appointments are excluded by the constraint's
  -- predicate, so a cancelled slot is immediately rebookable.
  update appointment set status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'CUSTOMER'
    where resource_id = v_res and start_at = '2026-09-01T09:00:00Z';
  insert into appointment (business_id, resource_id, service_id, customer_id,
      start_at, end_at, occupied_until, service_name, price_minor, duration_minutes, buffer_minutes)
    values (v_biz, v_res, v_svc, v_user, '2026-09-01T09:00:00Z', '2026-09-01T09:30:00Z',
            '2026-09-01T09:40:00Z', 'probe cut', 8000, 30, 10);

  -- ADR 0006: the audit trail is append-only, enforced rather than intended.
  insert into audit_log (actor_id, action, entity_type, entity_id) values (v_user, 'PROBE', 'Probe', 'x');
  v_failed := false;
  begin
    update audit_log set action = 'TAMPERED' where action = 'PROBE';
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'INVARIANT BROKEN: audit_log was rewritable'; end if;

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

  raise exception 'ALL_INVARIANTS_HELD';
end $$;
