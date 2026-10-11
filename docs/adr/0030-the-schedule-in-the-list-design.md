# 30. The schedule in the list design

Date: 2026-10-11

## Status

Accepted. Builds on ADR 0002 (the week is stored as ranges per weekday), ADR
0025 (one change to a day, for a calendar or the whole business) and ADR 0029
(one list design).

## Context

The schedule was the last screen out of step with the lists. The usual week
showed "רוב הימים" and "ימים אחרים", and every day that differed was a full
editor down the page, so the save button was a long scroll away. Calendars were
plain chips without the colour they wear everywhere else. The changes were loose
rows. And a calendar's list left out the business's own changes, though they
change that calendar's hours too.

## Decision

- **Two tabs, "שעות קבועות" and "שינויים",** each with one line under it saying
  what it is for. The usual line says that appointments already booked do not
  move.
- **The calendars** are chips with their lane colour. "כל העסק" is a chip on
  the changes only.
- **The usual hours** are one card with the hour timeline under them and the
  days that keep them. "+ הוספת הפסקה" cuts an hour out of the longest
  stretch, on the hour nearest its middle; a stretch too short for that gets a
  new stretch after the last. Overlapping stretches name the one range they
  will be saved as.
- **The days that differ,** a day off included, are one short row each. A row
  opens that day alone in a sheet: "לא עובדים" or "שעות אחרות", its hours with
  their timeline, "אישור", and "להחזיר לשעות הרגילות". A day stays in the list
  until it is put back, so a row never jumps away under the finger. Once four
  worked days differ, the screen suggests day by day: all seven days as rows.
- **A week with no hours** says so and why, and saving waits for at least one
  day.
- **One save,** "שמירת השעות", is pinned at the bottom of the screen at every
  width. Switching calendar or tab with unsaved hours asks first: save and move
  on, move on without saving, or stay.
- **The changes** are dated rows, the day large at the start. A calendar's list
  holds its own changes and the business's, marked "כל העסק". With several
  calendars, a business change opened from a calendar's list is read there and
  edited under "כל העסק". With one calendar there is nowhere else to send it,
  so it is edited where it is listed. Past a dozen, the list is split by month.
  A worker reads the business's changes and adds only to their own calendars.
- **Ranges read left to right** in both languages. An en dash does not hold two
  numbers together in a Hebrew line, so a range in a sentence is drawn as its
  own left-to-right piece.

The onboarding wizard uses the same week editor, without a calendar to name.

## Consequences

Nothing changes in what is stored: the usual and the days that differ are still
worked out from plain weekday ranges on the way in, and written back as ranges.
The only new rule is that a week needs at least one working day before it can
be saved.
