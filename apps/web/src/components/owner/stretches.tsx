"use client";

import { mergedRanges, type TimeRange } from "@tor-now/domain";
import { useCopy } from "@/lib/i18n/index.tsx";
import { breakBetween, collidesWithPrevious, isUsable } from "./usual-week.ts";
import { DEFAULT_OPENING } from "./week.ts";

/**
 * The stretches of one day, and the controls for saying them.
 *
 * Shared, because a day is a day: the week's usual hours, a day that departs
 * from it, a date that overrides the week, and the hours of a blockage are all
 * "a list of stretches with gaps between them", and an owner should not have to
 * learn each one separately. It began inside the week editor and moved here the
 * moment the second screen needed it.
 */

/** A new stretch starts an hour after the last one ends, so it lands as a break. */
const AFTER_THE_LAST = 60;
/** Wide enough for "09:00", so a label can be centred on its mark. */
const LABEL_WIDTH = 40;

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
/**
 * The day drawn as a bar: where it is open, and where the breaks fall.
 *
 * Three stretches are six times in a column, which nobody reads as a shape. The
 * bar is what makes a day with two breaks legible at a glance, and it costs no
 * interaction — it is a picture of what the fields already say.
 */
export const DayBar = ({ ranges }: { ranges: readonly TimeRange[] }) => {
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
export const Stretches = ({
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
                label={copy.from}
                value={range.start}
                onChange={(start) => at(position, (found) => ({ ...found, start }))}
                onDone={tidy}
              />
              <span aria-hidden="true" style={{ color: "var(--faint)", flexShrink: 0 }}>
                –
              </span>
              <Clock
                id={`to-${id}-${position}`}
                label={copy.to}
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
