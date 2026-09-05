"use client";

import { useState } from "react";
import { mergedRanges, type TimeRange } from "@tor-now/domain";
import { Button, Card, Field, Note } from "../ui.tsx";
import { useCopy } from "@/lib/i18n/index.tsx";
import {
  breakBetween,
  collidesWithPrevious,
  exceptionsTo,
  usualOf,
} from "./usual-week.ts";

/**
 * A week of working hours, said the way a person says it.
 *
 * "I'm open nine to five, Friday till one, closed Saturday" leads with the
 * usual and then names what departs from it. So does this: one card for the
 * hours most days keep, and a card for each day that does something else.
 *
 * What it replaced asked for the week twice — a bulk editor with an "apply to
 * all" button, and then seven day cards holding the same information, with no
 * way to tell which of the two you were looking at. Here there is one copy of
 * every fact: change the usual and every day on it moves, because those days
 * *are* the usual rather than a copy taken from it.
 *
 * ADR 0002 is untouched. The store keeps ranges per weekday and knows nothing
 * of a "usual" — that is worked out on the way in (see usual-week.ts) and
 * written back as plain ranges on the way out.
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

export const DEFAULT_OPENING = { start: "09:00", end: "17:00" };
export const DEFAULT_OPEN_DAYS = [0, 1, 2, 3, 4];

/** Once this many days go their own way, "most days" has stopped being true. */
const TOO_MANY_EXCEPTIONS = 5;
/** A new stretch starts an hour after the last one ends, so it lands as a break. */
const AFTER_THE_LAST = 60;

export const emptyWeek = (): DayHours[] =>
  Array.from({ length: 7 }, (_unused, day) => ({
    open: DEFAULT_OPEN_DAYS.includes(day),
    ranges: [{ start: DEFAULT_OPENING.start, end: DEFAULT_OPENING.end }],
  }));

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

const minutesOf = (clock: string): number => {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const clockOf = (minutes: number): string => {
  const held = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hour = String(Math.floor(held / 60) % 24).padStart(2, "0");
  return `${hour}:${String(held % 60).padStart(2, "0")}`;
};

/**
 * The day drawn as a bar: where it is open, and where the breaks fall.
 *
 * Three stretches are six times in a column, which nobody reads as a shape. The
 * bar is what makes a day with two breaks legible at a glance, and it costs no
 * interaction — it is a picture of what the fields already say.
 */
const DayBar = ({ ranges }: { ranges: readonly TimeRange[] }) => {
  const open = mergedRanges(ranges);
  if (open.length === 0) return null;

  const first = open[0];
  const last = open[open.length - 1];
  if (first === undefined || last === undefined) return null;

  const from = Math.max(0, Math.floor((minutesOf(first.start) - 60) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil((minutesOf(last.end) + 60) / 60) * 60);
  const across = Math.max(60, to - from);
  const at = (minutes: number) => ((minutes - from) / across) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          height: 30,
          borderRadius: 10,
          background: "var(--sunken)",
          overflow: "hidden",
        }}
      >
        {open.map((range) => (
          <span
            key={`${range.start}-${range.end}`}
            style={{
              position: "absolute",
              top: 6,
              bottom: 6,
              insetInlineStart: `${at(minutesOf(range.start))}%`,
              width: `${at(minutesOf(range.end)) - at(minutesOf(range.start))}%`,
              borderRadius: 6,
              background: "var(--accent)",
              opacity: 0.9,
            }}
          />
        ))}
      </div>
      <div
        className="hint tab"
        aria-hidden="true"
        style={{ display: "flex", justifyContent: "space-between" }}
      >
        <span>{clockOf(from)}</span>
        <span>{clockOf(to)}</span>
      </div>
    </div>
  );
};

/**
 * The stretches one day is open for, and what sits between them.
 *
 * The gap is named and given its times, because a list of four times says
 * nothing about which two of them are the break. Two stretches that run into
 * one another say so rather than being silently collapsed under the hand
 * editing them; the merge still happens on the way to the store.
 */
const Stretches = ({
  id,
  ranges,
  setRanges,
}: {
  id: string;
  ranges: TimeRange[];
  setRanges: (ranges: TimeRange[]) => void;
}) => {
  const copy = useCopy("owner");

  const at = (position: number, change: (range: TimeRange) => TimeRange) =>
    setRanges(ranges.map((range, index) => (index === position ? change(range) : range)));

  return (
    <>
      {ranges.map((range, position) => {
        const gap = breakBetween(ranges, position);
        return (
          <div
            key={position}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {position > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  color: collidesWithPrevious(ranges, position)
                    ? "var(--critical)"
                    : "var(--faint)",
                  fontSize: 12.5,
                }}
              >
                <Rule />
                <span className="tab">
                  {gap === null
                    ? copy.rangesOverlap
                    : `${copy.breakOf} · ${gap.start}–${gap.end}`}
                </span>
                <Rule />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div
                style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
              >
                <Field
                  id={`from-${id}-${position}`}
                  label={copy.from}
                  type="time"
                  value={range.start}
                  onChange={(event) =>
                    at(position, (found) => ({ ...found, start: event.target.value }))
                  }
                />
                <Field
                  id={`to-${id}-${position}`}
                  label={copy.to}
                  type="time"
                  value={range.end}
                  onChange={(event) =>
                    at(position, (found) => ({ ...found, end: event.target.value }))
                  }
                />
              </div>
              {ranges.length > 1 && (
                <button
                  aria-label={`${copy.delete} ${range.start}-${range.end}`}
                  onClick={() =>
                    setRanges(ranges.filter((_unused, index) => index !== position))
                  }
                  style={{ color: "var(--critical)", fontSize: 13, minHeight: 48 }}
                >
                  {copy.delete}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <DayBar ranges={ranges} />

      <button
        className="chip tap"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const last = ranges[ranges.length - 1];
          const start =
            last === undefined
              ? minutesOf(DEFAULT_OPENING.start)
              : Math.min(minutesOf(last.end) + AFTER_THE_LAST, 23 * 60);
          setRanges([
            ...ranges,
            { start: clockOf(start), end: clockOf(Math.min(start + 120, 24 * 60)) },
          ]);
        }}
      >
        {copy.addRange}
      </button>
    </>
  );
};

const Rule = () => (
  <span
    aria-hidden="true"
    style={{
      flex: 1,
      height: 1,
      background:
        "repeating-linear-gradient(90deg,var(--line) 0 5px,transparent 5px 10px)",
    }}
  />
);

export const WeeklyHours = ({
  hours,
  setHours,
}: {
  hours: DayHours[];
  setHours: (hours: DayHours[]) => void;
}) => {
  const copy = useCopy("owner");
  /**
   * Days the owner has pulled out of the usual by hand. Not stored: it only
   * keeps a day from being swallowed back into the group while its hours still
   * happen to match, which would read as the screen undoing the tap.
   */
  const [apart, setApart] = useState<number[]>([]);
  const [dayByDay, setDayByDay] = useState(false);

  const usual = usualOf(hours, apart);
  const exceptions = exceptionsTo(usual);

  const setDay = (dayOfWeek: number, change: (day: DayHours) => DayHours) =>
    setHours(atDay(hours, dayOfWeek, change));

  /** The usual is the days themselves, so editing it edits all of them. */
  const setUsualRanges = (ranges: TimeRange[]) =>
    setHours(
      hours.map((day, dayOfWeek) =>
        usual.days.includes(dayOfWeek) ? { ...day, ranges } : day,
      ),
    );

  const joinTheUsual = (dayOfWeek: number) => {
    setApart(apart.filter((day) => day !== dayOfWeek));
    setDay(dayOfWeek, () => ({ open: true, ranges: [...usual.ranges] }));
  };

  const leaveTheUsual = (dayOfWeek: number, closed: boolean) => {
    if (!apart.includes(dayOfWeek)) setApart([...apart, dayOfWeek]);
    setDay(dayOfWeek, (day) => ({
      open: !closed,
      ranges: day.ranges.length > 0 ? day.ranges : [...usual.ranges],
    }));
  };

  if (dayByDay) {
    return (
      <>
        <Button intent="quiet" onClick={() => setDayByDay(false)}>
          {copy.backToMostDays}
        </Button>
        {hours.map((day, dayOfWeek) => (
          <Card key={dayOfWeek} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <OpenSwitch
              dayOfWeek={dayOfWeek}
              day={day}
              onChange={(open) => setDay(dayOfWeek, (found) => ({ ...found, open }))}
            />
            {day.open && (
              <Stretches
                id={`day-${dayOfWeek}`}
                ranges={day.ranges}
                setRanges={(ranges) => setDay(dayOfWeek, (found) => ({ ...found, ranges }))}
              />
            )}
          </Card>
        ))}
        <Note>{copy.perDayNote}</Note>
      </>
    );
  }

  return (
    <>
      {exceptions.length >= TOO_MANY_EXCEPTIONS && (
        <>
          <p className="warn" style={{ margin: 0 }}>
            {copy.everyDayDiffers}
          </p>
          <Button intent="quiet" onClick={() => setDayByDay(true)}>
            {copy.editDayByDay}
          </Button>
        </>
      )}

      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="label">{copy.mostDays}</span>

        {usual.days.length === 0 ? (
          <Note>{copy.noUsualYet}</Note>
        ) : (
          <Stretches id="usual" ranges={[...usual.ranges]} setRanges={setUsualRanges} />
        )}

        <div style={{ height: 1, background: "var(--line)" }} />
        <span className="hint">{copy.daysOnTheseHours}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {copy.dayShort.map((short, dayOfWeek) => {
            const following = usual.days.includes(dayOfWeek);
            return (
              <button
                key={dayOfWeek}
                className="chip"
                aria-pressed={following}
                aria-label={copy.days[dayOfWeek]}
                onClick={() =>
                  following ? leaveTheUsual(dayOfWeek, true) : joinTheUsual(dayOfWeek)
                }
                style={{
                  minWidth: 44,
                  padding: "0 10px",
                  background: following ? "var(--accent)" : "var(--sunken)",
                  color: following ? "var(--on-accent)" : "var(--faint)",
                  border: `1px solid ${following ? "var(--accent)" : "var(--line)"}`,
                }}
              >
                {short}
              </button>
            );
          })}
        </div>
      </Card>

      {exceptions.length > 0 && <span className="label">{copy.otherDays}</span>}

      {exceptions.map((dayOfWeek) => {
        const day = hours[dayOfWeek];
        if (day === undefined) return null;
        return (
          <Card key={dayOfWeek} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{ flex: 1, fontWeight: 600, color: day.open ? undefined : "var(--faint)" }}
              >
                {copy.days[dayOfWeek]}
              </span>
              {usual.days.length > 0 && (
                <button
                  className="chip tap"
                  style={{ minHeight: 38, padding: "0 13px", fontSize: 13 }}
                  onClick={() => joinTheUsual(dayOfWeek)}
                >
                  {copy.backToUsual}
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <ChoiceChip
                chosen={!day.open}
                label={copy.closed}
                onClick={() => leaveTheUsual(dayOfWeek, true)}
              />
              <ChoiceChip
                chosen={day.open}
                label={copy.otherHours}
                onClick={() => leaveTheUsual(dayOfWeek, false)}
              />
            </div>

            {day.open && (
              <Stretches
                id={`day-${dayOfWeek}`}
                ranges={day.ranges}
                setRanges={(ranges) => setDay(dayOfWeek, (found) => ({ ...found, ranges }))}
              />
            )}
          </Card>
        );
      })}

      <Note>{copy.perDayNote}</Note>
    </>
  );
};

/** Chosen or not — the tinted fill is this system's selected state. */
const ChoiceChip = ({
  chosen,
  label,
  onClick,
}: {
  chosen: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={chosen ? "chip" : "chip tap"}
    aria-pressed={chosen}
    onClick={onClick}
    style={{
      minHeight: 38,
      padding: "0 14px",
      fontSize: 13,
      ...(chosen
        ? {
            background: "var(--accent-soft)",
            border: "1px solid oklch(52% 0.123 245/.25)",
            color: "var(--accent-strong)",
          }
        : {}),
    }}
  >
    {label}
  </button>
);

const OpenSwitch = ({
  dayOfWeek,
  day,
  onChange,
}: {
  dayOfWeek: number;
  day: DayHours;
  onChange: (open: boolean) => void;
}) => {
  const copy = useCopy("owner");
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input
        type="checkbox"
        checked={day.open}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span style={{ flex: 1, fontWeight: 500 }}>{copy.days[dayOfWeek]}</span>
      <span className="hint">{day.open ? copy.open : copy.closed}</span>
    </label>
  );
};
