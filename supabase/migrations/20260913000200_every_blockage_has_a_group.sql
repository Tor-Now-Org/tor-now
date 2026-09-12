-- ---------------------------------------------------------------------------
-- Every blockage belongs to a decision, including the ones made before there
-- were decisions.
--
-- 20260911000100 gave Blocks a group_id so that a blockage covering several
-- days could be read, renamed and given back as the one thing it was. It was
-- added nullable, because the Blocks already in the table had no group — and
-- every screen has been quietly wrong about those ever since.
--
-- The month reads a groupless Block back with its *own id* standing in for the
-- group, which looks right and is not: renaming it asks to rename the group
-- with that id and matches nothing, and removing it deletes the group with that
-- id, which is also nothing. Both came back saying they had done it. An owner
-- with a blockage from before that migration could neither rename nor remove
-- it, and was told nothing about why.
--
-- Each of those is its own decision — nothing else was made with it — so each
-- becomes a group of one, named by its own id, which is exactly what the
-- screens have been assuming all along. After that the column can say what has
-- been true of every Block written since: it has a group.
-- ---------------------------------------------------------------------------

update block set group_id = id where group_id is null;

alter table block alter column group_id set not null;
