import { addDays, type LocalDate, type LocalTimeRangeValue } from "@tor-now/domain";

/**
 * A run of days the shop decided about, as the one decision it was.
 *
 * The store has no closure entity — ADR 0002 keeps the schedule per calendar,
 * and a closure is an Override on every calendar for every date (see
 * closure-service). So "the shop is away all next week" is read back rather
 * than recorded, the same way the month already reads "the shop is shut today"
 * from every calendar agreeing.
 *
 * Shut and shorter are both in here. A day the shop keeps different hours on is
 * as much its decision as a day it closes, and leaving it out is what made a
 * half-day invisible on the calendar: the square went pale and there was
 * nothing to open, nothing to read, and no way to undo it.
 *
 * Two days join up when they are next to each other and the shop did the same
 * thing on both for the same stated reason. A different note is a different
 * decision, and an unstated reason joins only other unstated ones — which
 * keeps "Passover" from swallowing the unrelated Sunday beside it.
 */

export type ShopDay = {
  readonly date: LocalDate;
  readonly shopClosed: boolean;
  readonly shopHours: readonly LocalTimeRangeValue[];
  readonly shopNote: string | null;
};

export type ClosureBand = {
  readonly fromDate: LocalDate;
  readonly toDate: LocalDate;
  readonly days: number;
  readonly note: string | null;
  /** Shut altogether, or open on hours of its own. */
  readonly kind: "SHUT" | "HOURS";
  /** The hours kept. Empty for a day that is shut. */
  readonly hours: readonly LocalTimeRangeValue[];
};

/** Two days are the same decision when the shop is doing the same thing on them. */
const sameDecision = (band: ClosureBand, day: ShopDay, kind: ClosureBand["kind"]): boolean =>
  band.kind === kind &&
  band.note === day.shopNote &&
  JSON.stringify(band.hours) === JSON.stringify(day.shopHours) &&
  addDays(band.toDate, 1) === day.date;

export const closureBandsOf = (days: readonly ShopDay[]): ClosureBand[] => {
  const spoken = days.filter((day) => day.shopClosed || day.shopHours.length > 0);

  return spoken.reduce<ClosureBand[]>((bands, day) => {
    const kind = day.shopClosed ? "SHUT" : "HOURS";
    const open = bands[bands.length - 1];

    if (open === undefined || !sameDecision(open, day, kind)) {
      return [
        ...bands,
        {
          fromDate: day.date,
          toDate: day.date,
          days: 1,
          note: day.shopNote,
          kind,
          hours: day.shopHours,
        },
      ];
    }

    return [...bands.slice(0, -1), { ...open, toDate: day.date, days: open.days + 1 }];
  }, []);
};
