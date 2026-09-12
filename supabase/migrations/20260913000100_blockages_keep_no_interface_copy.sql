-- ---------------------------------------------------------------------------
-- Blockages stop carrying a sentence of interface copy as their reason.
--
-- The screens used to default an undescribed blockage's reason to whatever the
-- interface called one — "יש חסימה ביום הזה" / "This day has a block" — and
-- wrote that into the row. So a blockage nobody described came back out as a
-- sentence, and every screen then rendered it as though the owner had typed
-- it: in a sheet heading, in a month band, in a week's list.
--
-- The code no longer does this — an undescribed blockage stores nothing, and
-- each screen says what it wants to call one — but the rows that were written
-- that way are still out there saying it. This is that copy, taken back out of
-- the data.
--
-- Only the exact strings the interface used. A reason that merely contains
-- those words is something somebody typed, and is theirs.
-- ---------------------------------------------------------------------------

update block
set reason = ''
where reason in ('יש חסימה ביום הזה', 'This day has a block');
