"use client";

import type { ChangeOutcome, ClockRange } from "@/lib/api/types.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { quickChips } from "./change-model.ts";
import { Clock } from "./stretches.tsx";

/** A new stretch starts an hour after the last one ends, so it lands as a second one. */
const AFTER_THE_LAST = 60;

const shifted = (clock: string, minutes: number) => {
  const [hour, minute] = clock.split(":").map(Number);
  const total = Math.min(24 * 60 - 1, (hour ?? 0) * 60 + (minute ?? 0) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const isClock = (text: string) => /^\d{2}:\d{2}$/.test(text);

/**
 * The hours of a change: hours off for part of the day, hours kept for other
 * hours. Several stretches when a day needs them, and the ordinary answers one
 * tap away. The clocks are the week editor's, so a time looks the same here as
 * everywhere else it is typed.
 */
export const ChangeHours = ({
  outcome,
  ranges,
  usual,
  onChange,
}: {
  outcome: Extract<ChangeOutcome, "OFF_PART" | "OTHER_HOURS">;
  ranges: readonly ClockRange[];
  usual: readonly ClockRange[];
  onChange: (ranges: readonly ClockRange[]) => void;
}) => {
  const copy = useCopy("change");
  const at = (position: number, edit: Partial<ClockRange>) =>
    onChange(ranges.map((range, index) => (index === position ? { ...range, ...edit } : range)));
  const last = ranges.at(-1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingInlineStart: 26 }}>
      {ranges.map((range, position) => (
        <div key={position} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Clock
            id={`change-${outcome}-from-${position}`}
            label={copy.from}
            value={range.start}
            onChange={(start) => at(position, { start })}
            onDone={() => undefined}
          />
          <span aria-hidden="true" style={{ color: "var(--faint)" }}>–</span>
          <Clock
            id={`change-${outcome}-until-${position}`}
            label={copy.until}
            value={range.end}
            wrong={isClock(range.start) && isClock(range.end) && range.end <= range.start}
            onChange={(end) => at(position, { end })}
            onDone={() => undefined}
          />
          {ranges.length > 1 && (
            <button
              type="button"
              className="change-range-x"
              aria-label={`${copy.removeRange} ${range.start}–${range.end}`}
              onClick={() => onChange(ranges.filter((_range, index) => index !== position))}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="link-button"
        style={{ alignSelf: "start" }}
        onClick={() => {
          const start = last === undefined ? "12:00" : shifted(last.end, AFTER_THE_LAST);
          onChange([...ranges, { start, end: shifted(start, 60) }]);
        }}
      >
        {copy.anotherRange}
      </button>
      <div role="group" aria-label={copy.quickLabel} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {quickChips(outcome, usual).map((chip) => (
          <button key={chip.label} type="button" className="chip tap change-quick" onClick={() => onChange(chip.apply(ranges))}>
            {chip.time === undefined ? copy[chip.label] : fillText(copy[chip.label], { time: chip.time })}
          </button>
        ))}
      </div>
    </div>
  );
};
