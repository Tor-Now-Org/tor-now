-- ---------------------------------------------------------------------------
-- Which terms a User agreed to, and when
--
-- The Terms of Service and Privacy Policy (docs/legal) carry a version, the
-- date the text took effect. Agreeing — sending a sign-in code under the
-- consent line, ticking the box when opening a Business, or acknowledging an
-- update — records that version here. The audit trail records each agreement
-- too, but is pruned after a year; the agreement itself outlives that, so the
-- latest one is kept on the row.
--
-- The two columns are set together or not at all.
-- ---------------------------------------------------------------------------

alter table app_user
  add column terms_version     text,
  add column terms_accepted_at timestamptz,
  add constraint app_user_terms_together
    check ((terms_version is null) = (terms_accepted_at is null));

comment on column app_user.terms_version is
  'The TERMS_VERSION (packages/domain) this User last agreed to; null for someone who never has.';
