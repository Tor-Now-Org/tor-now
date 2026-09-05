"use client";

import { mergedRanges, type TimeRange } from "@tor-now/domain";
import { Button, Card, Field, Note } from "../ui.tsx";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * A week of working hours, said the way a person describes them.
 *
 * ADR 0002 stores ranges, and a break is the gap between two of them — true,
 * and no way to ask somebody what time they open. This is the wizard's editor,
 * lifted out of it: most businesses keep the same hours most days, so that is
 * offered first and any one day may then diverge.
 *
 * It was the wizard's alone, which meant a business described its week once in
 * friendly terms and every edit afterwards happened in a list of ranges with an
 * add and a delete. The same week deserves the same words both times.
 */
/**
 * A day, as a person describes it: open or not, and the stretches it is open
 * for. ADR 0002 has no break entity — a break is the gap between two ranges —
 * so a day that shuts for lunch simply has two of them, and a day with three
 * stretches is no harder to say than a day with two.
 */
export type DayHours = {
  open: boolean;
  ranges: TimeRange[];
};

/** What the bulk editor is currently set to apply. */
export type BulkHours = {
  days: number[];
  start: string;
  end: string;
  withBreak: boolean;
  breakFrom: string;
  breakTo: string;
};

export const DEFAULT_OPENING = { start: "09:00", end: "17:00" };
export const DEFAULT_OPEN_DAYS = [0, 1, 2, 3, 4];

export const emptyWeek = (): DayHours[] =>
  Array.from({ length: 7 }, (_unused, day) => ({
    open: DEFAULT_OPEN_DAYS.includes(day),
    ranges: [{ start: DEFAULT_OPENING.start, end: DEFAULT_OPENING.end }],
  }));

export const emptyBulk = (): BulkHours => ({
  days: [...DEFAULT_OPEN_DAYS],
  start: DEFAULT_OPENING.start,
  end: DEFAULT_OPENING.end,
  withBreak: false,
  breakFrom: "13:00",
  breakTo: "16:00",
});

/**
 * The ranges ADR 0002 stores, from the day a person described — merged, so two
 * that overlap or touch are stored as the one stretch they describe rather than
 * as a break of no length.
 */
export const rangesFor = (
  day: DayHours,
  dayOfWeek: number,
): { dayOfWeek: number; start: string; end: string }[] =>
  day.open
    ? mergedRanges(day.ranges).map((range) => ({ dayOfWeek, ...range }))
    : [];

/** The inverse, for a week that already exists, tidied on the way in. */
export const weekFromRanges = (
  ranges: readonly { dayOfWeek: number; start: string; end: string }[],
): DayHours[] =>
  Array.from({ length: 7 }, (_unused, dayOfWeek) => {
    const onThisDay = mergedRanges(
      ranges.filter((range) => range.dayOfWeek === dayOfWeek),
    );
    return onThisDay.length === 0
      ? {
          open: false,
          ranges: [{ start: DEFAULT_OPENING.start, end: DEFAULT_OPENING.end }],
        }
      : { open: true, ranges: onThisDay };
  });

/** One day changed, the rest untouched. */
const atDay = (
  week: DayHours[],
  dayOfWeek: number,
  change: (day: DayHours) => DayHours,
): DayHours[] => week.map((day, index) => (index === dayOfWeek ? change(day) : day));

export const WeeklyHours = ({
  hours,
  setHours,
  bulk,
  setBulk,
}: {
  hours: DayHours[];
  setHours: (hours: DayHours[]) => void;
  bulk: BulkHours;
  setBulk: (bulk: BulkHours) => void;
}) => {
  const copy = useCopy("owner");
  return (
    <>
          {/* Most businesses keep the same hours most days, so the wizard
              offers that first and lets any one day diverge below. */}
          <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span className="label">{copy.sameForAll}</span>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="hint">{copy.whichDays}</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {copy.dayShort.map((short, dayOfWeek) => {
                  const chosen = bulk.days.includes(dayOfWeek);
                  return (
                    <button
                      key={dayOfWeek}
                      className="chip"
                      aria-pressed={chosen}
                      aria-label={copy.days[dayOfWeek]}
                      onClick={() =>
                        setBulk({
                          ...bulk,
                          days: chosen
                            ? bulk.days.filter((day) => day !== dayOfWeek)
                            : [...bulk.days, dayOfWeek],
                        })
                      }
                      style={{
                        minWidth: 44,
                        padding: "0 10px",
                        background: chosen ? "var(--accent)" : "var(--raised)",
                        color: chosen ? "var(--on-accent)" : "var(--ink)",
                        border: `1px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
                      }}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field id="bulk-from" label={copy.from} type="time" value={bulk.start}
                onChange={(event) => setBulk({ ...bulk, start: event.target.value })} />
              <Field id="bulk-to" label={copy.to} type="time" value={bulk.end}
                onChange={(event) => setBulk({ ...bulk, end: event.target.value })} />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={bulk.withBreak}
                onChange={(event) => setBulk({ ...bulk, withBreak: event.target.checked })}
              />
              <span style={{ fontSize: 14.5 }}>{copy.withBreak}</span>
            </label>

            {bulk.withBreak && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field id="break-from" label={copy.breakFrom} type="time" value={bulk.breakFrom}
                  onChange={(event) => setBulk({ ...bulk, breakFrom: event.target.value })} />
                <Field id="break-to" label={copy.breakTo} type="time" value={bulk.breakTo}
                  onChange={(event) => setBulk({ ...bulk, breakTo: event.target.value })} />
              </div>
            )}

            <Button
              intent="quiet"
              disabled={bulk.days.length === 0 || bulk.end <= bulk.start}
              onClick={() =>
                setHours(
                  hours.map((day, dayOfWeek) =>
                    bulk.days.includes(dayOfWeek)
                      ? {
                          open: true,
                          ranges: bulk.withBreak
                            ? [
                                { start: bulk.start, end: bulk.breakFrom },
                                { start: bulk.breakTo, end: bulk.end },
                              ]
                            : [{ start: bulk.start, end: bulk.end }],
                        }
                      : day,
                  ),
                )
              }
            >
              {copy.applyToAll}
            </Button>

            <Note>{copy.perDayNote}</Note>
          </Card>

          {hours.map((day, dayOfWeek) => (
            <Card key={dayOfWeek} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={day.open}
                  onChange={(event) =>
                    setHours(hours.map((d, i) => (i === dayOfWeek ? { ...d, open: event.target.checked } : d)))
                  }
                />
                <span style={{ flex: 1, fontWeight: 500 }}>{copy.days[dayOfWeek]}</span>
                <span className="hint">{day.open ? copy.open : copy.closed}</span>
              </label>
              {day.open && (
                <>
                  {/* One row per stretch the day is open for. Two of them are
                      what a break looks like; three are a day that opens,
                      shuts, opens and shuts again, which the store has always
                      been able to hold. */}
                  {day.ranges.map((range, position) => (
                    <div
                      key={position}
                      style={{ display: "flex", alignItems: "flex-end", gap: 10 }}
                    >
                      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <Field
                          id={`from-${dayOfWeek}-${position}`}
                          label={copy.from}
                          type="time"
                          value={range.start}
                          onChange={(event) =>
                            setHours(
                              atDay(hours, dayOfWeek, (entry) => ({
                                ...entry,
                                ranges: entry.ranges.map((candidate, index) =>
                                  index === position
                                    ? { ...candidate, start: event.target.value }
                                    : candidate,
                                ),
                              })),
                            )
                          }
                        />
                        <Field
                          id={`to-${dayOfWeek}-${position}`}
                          label={copy.to}
                          type="time"
                          value={range.end}
                          onChange={(event) =>
                            setHours(
                              atDay(hours, dayOfWeek, (entry) => ({
                                ...entry,
                                ranges: entry.ranges.map((candidate, index) =>
                                  index === position
                                    ? { ...candidate, end: event.target.value }
                                    : candidate,
                                ),
                              })),
                            )
                          }
                        />
                      </div>
                      {day.ranges.length > 1 && (
                        <button
                          aria-label={`${copy.delete} ${range.start}-${range.end}`}
                          onClick={() =>
                            setHours(
                              atDay(hours, dayOfWeek, (entry) => ({
                                ...entry,
                                ranges: entry.ranges.filter((_, index) => index !== position),
                              })),
                            )
                          }
                          style={{ color: "var(--critical)", fontSize: 13, minHeight: 44 }}
                        >
                          {copy.delete}
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="chip"
                    style={{ border: "1px dashed var(--line)", alignSelf: "flex-start" }}
                    onClick={() =>
                      setHours(
                        atDay(hours, dayOfWeek, (entry) => ({
                          ...entry,
                          ranges: [
                            ...entry.ranges,
                            {
                              start: entry.ranges[entry.ranges.length - 1]?.end ?? DEFAULT_OPENING.start,
                              end: DEFAULT_OPENING.end,
                            },
                          ],
                        })),
                      )
                    }
                  >
                    {copy.addRange}
                  </button>
                </>
              )}
            </Card>
          ))}
          <Note>{copy.perDayNote}</Note>
    </>
  );
};
