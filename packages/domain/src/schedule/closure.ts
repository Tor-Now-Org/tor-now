import { containsInterval, normalize } from "../time/interval.ts";
import type { LocalInterval } from "./open-hours.ts";

/**
 * What becomes of what is already booked when a day's hours are taken away.
 *
 * Closing the shop for a week is not only a note on a calendar: people hold
 * appointments inside it, and they are the part that cannot be left to be
 * discovered at the door. The rule is the same whether the day is shut
 * altogether or merely kept shorter — an Override replaces the weekday
 * entirely (ADR 0002), so the only question is whether the hours that remain
 * still hold the booking.
 *
 * Adjacent ranges are merged before the question is asked: a day kept as
 * 09:00–12:00 and 12:00–17:00 is open right through, and an appointment across
 * noon is not stranded by a seam that exists only in the way the hours were
 * typed.
 */
export const survivesHours = (
  booked: LocalInterval,
  open: readonly LocalInterval[],
): boolean => normalize(open).some((range) => containsInterval(range, booked));
