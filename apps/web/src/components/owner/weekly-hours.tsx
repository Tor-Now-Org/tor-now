"use client";

import { useState } from "react";
import type { TimeRange } from "@tor-now/domain";
import { Button, Card, Note } from "../ui.tsx";
import { useCopy } from "@/lib/i18n/index.tsx";
import { DEFAULT_OPENING, type DayHours } from "./week.ts";
import { exceptionsTo, usualOf } from "./usual-week.ts";
import { Stretches } from "./stretches.tsx";

// The week model moved to week.ts, where it can be tested without a renderer.
// The screens still reach it through this file, which is the thing they think
// they are using.
export {
  DEFAULT_OPENING,
  DEFAULT_OPEN_DAYS,
  emptyWeek,
  rangesFor,
  weekFromRanges,
} from "./week.ts";
export type { DayHours } from "./week.ts";

/** Once this many days go their own way, "most days" has stopped being true. */
const TOO_MANY_EXCEPTIONS = 5;

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
/** One day changed, the rest untouched. */
const atDay = (
  week: DayHours[],
  dayOfWeek: number,
  change: (day: DayHours) => DayHours,
): DayHours[] => week.map((day, index) => (index === dayOfWeek ? change(day) : day));

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
  const setUsualRanges = (ranges: TimeRange[]) => {
    // Pin the days that already differ. Move the usual to nine-to-one and a
    // Friday that already closed at one would match it, be swallowed into the
    // group, and vanish from the list of days that differ — the screen quietly
    // undoing a decision the owner made.
    const pinned = exceptions.filter((day) => hours[day]?.open === true);
    if (pinned.some((day) => !apart.includes(day))) {
      setApart([...new Set([...apart, ...pinned])]);
    }
    setHours(
      hours.map((day, dayOfWeek) =>
        usual.days.includes(dayOfWeek)
          ? // A copy each: sharing one array between five days is a mutation
            // away from editing Monday by editing Tuesday.
            { ...day, ranges: ranges.map((range) => ({ ...range })) }
          : day,
      ),
    );
  };

  /** What a day gets when it has nothing of its own to fall back on. */
  const someHours = (): TimeRange[] =>
    usual.ranges.length > 0
      ? usual.ranges.map((range) => ({ ...range }))
      : [{ ...DEFAULT_OPENING }];

  const joinTheUsual = (dayOfWeek: number) => {
    setApart(apart.filter((day) => day !== dayOfWeek));
    setDay(dayOfWeek, () => ({ open: true, ranges: someHours() }));
  };

  /**
   * A day leaves the usual keeping the hours it had.
   *
   * It used to leave shut, on the reasoning that a departing day is usually a
   * closed one. That made "this day is different" mean "this day is off", which
   * is a different sentence and a destructive one: an owner separating Thursday
   * to move it half an hour lost Thursday instead. Closing is one tap away on
   * the day's own card, and it is the owner who takes it.
   */
  const leaveTheUsual = (dayOfWeek: number, open = true) => {
    if (!apart.includes(dayOfWeek)) setApart([...apart, dayOfWeek]);
    setDay(dayOfWeek, (day) => ({
      open,
      ranges: day.ranges.length > 0 ? day.ranges : someHours(),
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
          <Stretches
            id="usual"
            ranges={usual.ranges.map((range) => ({ ...range }))}
            setRanges={setUsualRanges}
          />
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
                  following ? leaveTheUsual(dayOfWeek) : joinTheUsual(dayOfWeek)
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
                onClick={() => leaveTheUsual(dayOfWeek, false)}
              />
              <ChoiceChip
                chosen={day.open}
                label={copy.otherHours}
                onClick={() => leaveTheUsual(dayOfWeek, true)}
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
