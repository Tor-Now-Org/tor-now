-- ADR 0002: a day's working hours are ranges, and the gap between two of them
-- is the break. Two ranges that overlap on the same day describe nothing — the
-- interface merges them before it writes, and the domain's own rule says so —
-- but the table accepted them, and that is how a bug in the editor turned into
-- lost hours instead of a failed save: a day's stretch was written under
-- another day's number, so one day silently emptied and another silently
-- doubled. The store took it without a word.
--
-- The same shape as the appointment constraint (20260901000900): an exclusion
-- over the range, scoped by equality on who and when. What the code merges, the
-- table now refuses to hold unmerged.
create extension if not exists btree_gist;

alter table working_hours
  add constraint working_hours_do_not_overlap
  exclude using gist (
    resource_id with =,
    day_of_week with =,
    int4range(start_local::int, end_local::int) with &&
  );

comment on constraint working_hours_do_not_overlap on working_hours is
  'One day cannot be open twice over the same minutes. Half-open, so a range ending where the next begins is two ranges with no break, which the caller is expected to have merged.';
