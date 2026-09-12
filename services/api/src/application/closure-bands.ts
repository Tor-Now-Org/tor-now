import { addDays, type LocalDate } from "@tor-now/domain";

/**
 * A run of shut days, as the one decision it was.
 *
 * The store has no closure entity — ADR 0002 keeps the schedule per calendar,
 * and a closure is an Override on every calendar for every date (see
 * closure-service). So "the shop is away all next week" is read back rather
 * than recorded, the same way the month already reads "the shop is shut today"
 * from every calendar agreeing.
 *
 * Two days join up when they are next to each other and were shut for the same
 * stated reason. A different note is a different decision, and an unstated
 * reason joins only other unstated ones — which keeps "Passover" from
 * swallowing the unrelated Sunday beside it.
 */

export type ShutDay = {
  readonly date: LocalDate;
  readonly shopClosed: boolean;
  readonly shopNote: string | null;
};

export type ClosureBand = {
  readonly fromDate: LocalDate;
  readonly toDate: LocalDate;
  readonly days: number;
  readonly note: string | null;
};

export const closureBandsOf = (days: readonly ShutDay[]): ClosureBand[] => {
  const shut = days.filter((day) => day.shopClosed);

  return shut.reduce<ClosureBand[]>((bands, day) => {
    const open = bands[bands.length - 1];
    const joins =
      open !== undefined &&
      open.note === day.shopNote &&
      addDays(open.toDate, 1) === day.date;

    if (!joins) return [...bands, { fromDate: day.date, toDate: day.date, days: 1, note: day.shopNote }];

    return [
      ...bands.slice(0, -1),
      { ...open, toDate: day.date, days: open.days + 1 },
    ];
  }, []);
};
