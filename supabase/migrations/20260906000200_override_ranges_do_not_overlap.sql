-- The same rule as the weekly hours (20260906000100), for the layer above them.
-- A special day is a list of stretches with breaks between them, and two that
-- run together describe one stretch. The interface merges before it writes; the
-- API refuses what arrives unmerged; this is the last of the three, and the
-- only one that holds when neither of the others is in the path.
--
-- Scoped to the override rather than to the resource and date, because the
-- override row is what owns the stretches — one per resource per date already,
-- by its own unique constraint.
alter table date_override_range
  add constraint date_override_range_do_not_overlap
  exclude using gist (
    date_override_id with =,
    int4range(start_local::int, end_local::int) with &&
  );

comment on constraint date_override_range_do_not_overlap on date_override_range is
  'One special day cannot be open twice over the same minutes. Half-open, so a stretch ending where the next begins is two stretches with no break between them.';
