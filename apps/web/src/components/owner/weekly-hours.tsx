"use client";

import { useState } from "react";
import { mergedRanges, type TimeRange } from "@tor-now/domain";
import { Button, Card, Note } from "../ui.tsx";
import { useCopy } from "@/lib/i18n/index.tsx";
import {
  breakBetween,
  collidesWithPrevious,
  exceptionsTo,
  isUsable,
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
/** Wide enough for "09:00", so a label can be centred on its mark. */
const LABEL_WIDTH = 40;

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
  const open = mergedRanges(ranges.filter(isUsable));
  if (open.length === 0) return null;

  const first = open[0];
  const last = open[open.length - 1];
  if (first === undefined || last === undefined) return null;

  const from = Math.max(0, Math.floor((minutesOf(first.start) - 60) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil((minutesOf(last.end) + 60) / 60) * 60);
  const across = Math.max(60, to - from);
  const at = (minutes: number) => ((minutes - from) / across) * 100;

  // An hour marked every so often rather than every hour: a label per hour on a
  // phone is a grey smudge. The step is chosen so the marks stay about a
  // thumb's width apart however long the day is.
  const hours = across / 60;
  const step = hours <= 6 ? 1 : hours <= 12 ? 2 : 3;
  const marks: number[] = [];
  for (let minute = from; minute <= to; minute += step * 60) marks.push(minute);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }} aria-hidden="true">
      <div
        style={{
          position: "relative",
          height: 34,
          borderRadius: 11,
          background: "var(--sunken)",
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
      >
        {marks.map((minute) => (
          <span
            key={`tick-${minute}`}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              insetInlineStart: `${at(minute)}%`,
              width: 1,
              background: "var(--line)",
            }}
          />
        ))}
        {open.map((range) => (
          <span
            key={`${range.start}-${range.end}`}
            style={{
              position: "absolute",
              top: 5,
              bottom: 5,
              insetInlineStart: `${at(minutesOf(range.start))}%`,
              width: `${at(minutesOf(range.end)) - at(minutesOf(range.start))}%`,
              borderRadius: 7,
              background: "linear-gradient(180deg,var(--accent),var(--accent-strong))",
              boxShadow: "0 1px 2px oklch(25% 0.055 258/.18)",
            }}
          />
        ))}
      </div>
      {/* The hours themselves, under the marks they belong to. */}
      <div style={{ position: "relative", height: 14 }}>
        {marks.map((minute) => (
          <span
            key={`label-${minute}`}
            className="hint tab"
            style={{
              position: "absolute",
              // Centred on the mark by a symmetric box rather than a transform:
              // translateX goes the wrong way when the page turns around.
              insetInlineStart: `calc(${at(minute)}% - ${LABEL_WIDTH / 2}px)`,
              width: LABEL_WIDTH,
              textAlign: "center",
            }}
          >
            {clockOf(minute)}
          </span>
        ))}
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

  /**
   * Put the stretches in the order of the day, once the hand editing them has
   * left the field. Sorting on every keystroke would move the row somebody is
   * still typing into; leaving them unsorted makes the gap between two of them
   * a lie, since "what is between these" only means anything in order.
   */
  const tidy = () => {
    if (!ranges.every(isUsable)) return;
    const inOrder = [...ranges].sort((left, right) => left.start.localeCompare(right.start));
    if (inOrder.some((range, index) => range !== ranges[index])) setRanges(inOrder);
  };

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
                  {collidesWithPrevious(ranges, position)
                    ? copy.rangesOverlap
                    : gap === null
                      ? copy.breakOf
                      : `${copy.breakOf} · ${gap.start}–${gap.end}`}
                </span>
                <Rule />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Clock
                id={`from-${id}-${position}`}
                label={copy.opensAt}
                value={range.start}
                onChange={(start) => at(position, (found) => ({ ...found, start }))}
                onDone={tidy}
              />
              <span aria-hidden="true" style={{ color: "var(--faint)", flexShrink: 0 }}>
                –
              </span>
              <Clock
                id={`to-${id}-${position}`}
                label={copy.closesAt}
                value={range.end}
                onChange={(end) => at(position, (found) => ({ ...found, end }))}
                onDone={tidy}
              />
              {ranges.length > 1 && (
                <button
                  aria-label={`${copy.delete} ${range.start}-${range.end}`}
                  onClick={() =>
                    setRanges(ranges.filter((_unused, index) => index !== position))
                  }
                  style={{
                    flexShrink: 0,
                    width: 38,
                    height: 38,
                    borderRadius: 999,
                    color: "var(--muted)",
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
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

/**
 * One time, as a control worth tapping.
 *
 * It is a native time input underneath — which is what opens the phone's own
 * clock, the picker every owner already knows — wearing the app's face: the
 * hour large and in the display type, what it means small above it. A field
 * with a caption beside another field with a caption said the same thing in
 * the browser's own voice, which is the one voice the product does not use.
 */
const Clock = ({
  id,
  label,
  value,
  onChange,
  onDone,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) => {
  const usable = /^\d{2}:\d{2}$/.test(value);
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        padding: "5px 4px 7px",
        borderRadius: 14,
        background: usable ? "var(--raised)" : "var(--critical-soft)",
        border: `1px solid ${usable ? "var(--line)" : "oklch(55% 0.170 22/.45)"}`,
        boxShadow: "0 1px 2px oklch(25% 0.055 258/.06)",
      }}
    >
      <label htmlFor={id} style={{ fontSize: 10.5, fontWeight: 500, color: "var(--faint)" }}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onDone}
        style={{
          width: "100%",
          minHeight: 32,
          border: 0,
          outline: "none",
          background: "transparent",
          textAlign: "center",
          fontFamily: "Rubik, sans-serif",
          fontWeight: 600,
          fontSize: 18,
          letterSpacing: "-.01em",
          fontVariantNumeric: "tabular-nums",
          color: usable ? "var(--ink)" : "var(--critical)",
        }}
      />
    </span>
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
        usual.days.includes(dayOfWeek) ? { ...day, ranges } : day,
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

  const leaveTheUsual = (dayOfWeek: number, closed: boolean) => {
    if (!apart.includes(dayOfWeek)) setApart([...apart, dayOfWeek]);
    setDay(dayOfWeek, (day) => ({
      open: !closed,
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
