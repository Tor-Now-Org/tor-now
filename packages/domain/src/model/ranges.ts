/**
 * A day's working hours, tidied.
 *
 * ADR 0002 stores ranges and treats the gap between two of them as a break, so
 * ranges that overlap or merely touch are one continuous stretch described
 * twice — a break of negative or of zero length, which is not a thing a person
 * can take. Rather than refuse the input, which would mean explaining the
 * storage model to somebody describing their Tuesday, it is merged.
 *
 * Times are "HH:MM", which compares correctly as text within a day.
 */
export type TimeRange = { readonly start: string; readonly end: string };

export const mergedRanges = (ranges: readonly TimeRange[]): TimeRange[] => {
  const real = ranges
    .filter((range) => range.start < range.end)
    .sort((left, right) => left.start.localeCompare(right.start));

  return real.reduce<TimeRange[]>((merged, range) => {
    const last = merged[merged.length - 1];
    // Touching counts as overlapping: 09:00–13:00 and 13:00–17:00 leave no
    // moment between them, so they are one range from nine to five.
    if (last === undefined || range.start > last.end) return [...merged, range];
    return [
      ...merged.slice(0, -1),
      { start: last.start, end: range.end > last.end ? range.end : last.end },
    ];
  }, []);
};
