-- A blockage is one decision and often several intervals: a week away is seven
-- of them, an hour kept free across a fortnight is fourteen. The rows carried
-- nothing to say they belonged together, so the interface could only ever offer
-- "delete this one", once per row, and could not draw the holiday as the one
-- thing it was.
--
-- Nullable, because every block that already exists was made one at a time and
-- is its own group of one; the API gives every new block a group, including the
-- single ones, so "the group" is always a truthful answer to "what did this tap
-- create".
alter table block add column group_id uuid;

comment on column block.group_id is
  'What the block was created with. Blocks made by one decision share it, so a holiday can be shown and removed as one thing.';

-- Removing a whole blockage is the common write, and the day screen reads a
-- group to say "day 2 of 3".
create index block_by_group on block (group_id) where group_id is not null;
