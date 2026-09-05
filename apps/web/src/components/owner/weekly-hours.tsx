"use client";

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
export type DayHours = {
  open: boolean;
  start: string;
  end: string;
  /** A break splits the day into two ranges; ADR 0002 has no break entity. */
  breakFrom?: string;
  breakTo?: string;
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
    start: DEFAULT_OPENING.start,
    end: DEFAULT_OPENING.end,
  }));

export const emptyBulk = (): BulkHours => ({
  days: [...DEFAULT_OPEN_DAYS],
  start: DEFAULT_OPENING.start,
  end: DEFAULT_OPENING.end,
  withBreak: false,
  breakFrom: "13:00",
  breakTo: "16:00",
});

/** The ranges ADR 0002 stores, from the day a person described. */
export const rangesFor = (
  day: DayHours,
  dayOfWeek: number,
): { dayOfWeek: number; start: string; end: string }[] => {
  if (!day.open) return [];
  if (
    day.breakFrom === undefined ||
    day.breakTo === undefined ||
    day.breakFrom <= day.start ||
    day.breakTo >= day.end ||
    day.breakTo <= day.breakFrom
  ) {
    return [{ dayOfWeek, start: day.start, end: day.end }];
  }
  return [
    { dayOfWeek, start: day.start, end: day.breakFrom },
    { dayOfWeek, start: day.breakTo, end: day.end },
  ];
};

/**
 * The inverse, for a week that already exists. One range is a plain day; two
 * are a day with a break. More than two cannot be said in these words, and the
 * caller is told so rather than shown a lie.
 */
export const weekFromRanges = (
  ranges: readonly { dayOfWeek: number; start: string; end: string }[],
): { week: DayHours[]; tooComplex: number[] } => {
  const tooComplex: number[] = [];
  const week = Array.from({ length: 7 }, (_unused, dayOfWeek) => {
    const onThisDay = ranges
      .filter((range) => range.dayOfWeek === dayOfWeek)
      .sort((left, right) => left.start.localeCompare(right.start));
    if (onThisDay.length === 0) {
      return { open: false, start: DEFAULT_OPENING.start, end: DEFAULT_OPENING.end };
    }
    if (onThisDay.length === 1) {
      const only = onThisDay[0]!;
      return { open: true, start: only.start, end: only.end };
    }
    if (onThisDay.length > 2) tooComplex.push(dayOfWeek);
    const first = onThisDay[0]!;
    const last = onThisDay[onThisDay.length - 1]!;
    return {
      open: true,
      start: first.start,
      end: last.end,
      breakFrom: first.end,
      breakTo: onThisDay[1]!.start,
    };
  });
  return { week, tooComplex };
};

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
                          start: bulk.start,
                          end: bulk.end,
                          ...(bulk.withBreak
                            ? { breakFrom: bulk.breakFrom, breakTo: bulk.breakTo }
                            : {}),
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
              {day.open && day.breakFrom !== undefined && (
                <span className="hint">
                  {copy.withBreak}: {day.breakFrom}–{day.breakTo}
                </span>
              )}
              {day.open && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field
                    id={`from-${dayOfWeek}`}
                    label={copy.from}
                    type="time"
                    value={day.start}
                    onChange={(event) =>
                      setHours(hours.map((d, i) => (i === dayOfWeek ? { ...d, start: event.target.value } : d)))
                    }
                  />
                  <Field
                    id={`to-${dayOfWeek}`}
                    label={copy.to}
                    type="time"
                    value={day.end}
                    onChange={(event) =>
                      setHours(hours.map((d, i) => (i === dayOfWeek ? { ...d, end: event.target.value } : d)))
                    }
                  />
                </div>
              )}
            </Card>
          ))}
          <Note>{copy.perDayNote}</Note>
    </>
  );
};
