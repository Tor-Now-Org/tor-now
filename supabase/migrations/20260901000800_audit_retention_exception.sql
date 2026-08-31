-- ADR 0006 keeps audit rows for a year, which means something must eventually
-- delete them — and the append-only trigger refuses DELETE from every path,
-- which is the point.
--
-- Retention is the one sanctioned exception. It announces itself with a
-- transaction-local setting, so the exception cannot outlive the statement that
-- claimed it, and cannot leak to another caller over a pooled connection. An
-- UPDATE is still refused unconditionally: retention removes old rows, it never
-- rewrites one.
create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.audit_retention', true), '') = 'on' then
    return old;
  end if;
  raise exception 'audit_log is append-only';
end;
$$;
