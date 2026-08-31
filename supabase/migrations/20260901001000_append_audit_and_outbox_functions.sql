-- ADR 0006 writes the audit row inside the same transaction as the mutation it
-- describes — which means it is written by whichever role made the mutation,
-- and that role has no policy on audit_log. It must not have one: a table an
-- ordinary caller can write to directly is a trail an ordinary caller can
-- forge.
--
-- A SECURITY DEFINER function is the narrow grant that resolves this. It can
-- only append, never read, update or delete, and it lives in `app`, which is
-- not among the schemas Supabase exposes over PostgREST — so it is reachable
-- from the Edge Function's connection and from nowhere a client can call.
create or replace function app.append_audit(
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (p_actor_id, p_action, p_entity_type, p_entity_id, p_before, p_after);
$$;

revoke all on function app.append_audit(uuid, text, text, text, jsonb, jsonb) from public;
grant execute on function app.append_audit(uuid, text, text, text, jsonb, jsonb)
  to anon, authenticated;

-- The outbox has the same shape of problem for the same reason: ADR 0005
-- enqueues the message in the transaction that caused it, so the customer's own
-- connection writes the row, and the customer must not be able to reach the
-- table to read other people's messages or invent their own.
create or replace function app.enqueue_notification(
  p_recipient_phone text,
  p_template text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into notification_outbox (recipient_phone, template, payload)
  values (p_recipient_phone, p_template, p_payload);
$$;

revoke all on function app.enqueue_notification(text, text, jsonb) from public;
grant execute on function app.enqueue_notification(text, text, jsonb)
  to anon, authenticated;

comment on function app.append_audit(uuid, text, text, text, jsonb, jsonb) is
  'ADR 0006: the only way a non-privileged role may add to the trail, and it can do nothing else to it.';
