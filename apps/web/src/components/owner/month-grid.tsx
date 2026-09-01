"use client";

import { dayOfWeekOf, parseLocalDate } from "@tor-now/domain";
import type { MonthDayDto } from "@/lib/api/types.ts";

/**
 * A month, as a business reads one.
 *
 * The day strip answers "what is happening in the next fortnight"; this answers
 * "which days of the month are busy, and which are empty" — the question behind
 * taking a holiday, adding a shift, or ringing back a customer next Tuesday.
 *
 * Each square carries a count rather than a list. The list is a tap away and
 * already exists; what a grid is for is the shape of the month, and thirty
 * lists of names do not have a shape.
 */

const WEEK = 7;

/**
 * Sunday-first, which is the week this product's customers work.
 *
 * Dates cross this component as plain strings, the way they do everywhere else
 * in the interface; the domain's branded type is constructed at the one point a
 * domain function is called with one.
 */
const firstColumnOffset = (firstOfMonth: string): number =>
  dayOfWeekOf(parseLocalDate(firstOfMonth));

export const MonthGrid = ({
  firstOfMonth,
  days,
  selected,
  today,
  onSelect,
  weekdayNames,
  labels,
}: {
  firstOfMonth: string;
  days: readonly MonthDayDto[];
  selected: string;
  today: string;
  onSelect: (date: string) => void;
  /** Sunday first, matching the columns. */
  weekdayNames: readonly string[];
  labels: { appointments: string; blocked: string; empty: string };
}) => {
  const leading = firstColumnOffset(firstOfMonth);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${WEEK}, minmax(0, 1fr))`,
          gap: 4,
        }}
      >
        {weekdayNames.slice(0, WEEK).map((name) => (
          <span
            key={name}
            className="hint"
            style={{ textAlign: "center", fontSize: 11, fontWeight: 600 }}
          >
            {name}
          </span>
        ))}

        {/* The days of the previous month that share the first row. Rendered as
            spacers rather than as dates, because they belong to a month this
            grid is not showing and tapping one would be a surprise. */}
        {Array.from({ length: leading }, (_, index) => (
          <span key={`lead-${index}`} aria-hidden="true" />
        ))}

        {days.map((day) => {
          const date = day.date;
          const isSelected = date === selected;
          const isToday = date === today;
          const busy = day.appointments > 0;
          const dayNumber = Number(day.date.slice(8));
          return (
            <button
              key={day.date}
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-label={`${day.date} · ${
                busy ? `${day.appointments} ${labels.appointments}` : labels.empty
              }`}
              className="month-day"
              style={{
                background: isSelected ? "var(--accent)" : "var(--raised)",
                color: isSelected ? "var(--on-accent)" : "var(--ink)",
                borderColor: isSelected
                  ? "var(--accent)"
                  : isToday
                    ? "var(--accent)"
                    : "var(--line)",
                borderWidth: isToday && !isSelected ? 2 : 1,
              }}
            >
              <span className="tab" style={{ fontSize: 14, fontWeight: isToday ? 700 : 500 }}>
                {dayNumber}
              </span>
              {/* The count is the point of the square. A dot alone would say
                  "something" where a business needs "three". */}
              <span
                className="tab month-day-count"
                style={{
                  color: isSelected
                    ? "var(--on-accent)"
                    : busy
                      ? "var(--accent-strong)"
                      : "transparent",
                }}
              >
                {busy ? day.appointments : "0"}
              </span>
              {day.blocks > 0 && (
                <span
                  className="month-day-blocked"
                  title={labels.blocked}
                  style={{
                    background: isSelected ? "var(--on-accent)" : "var(--caution)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** The month a date belongs to, as its first day. */
export const firstOfMonthFor = (date: string): string => `${date.slice(0, 7)}-01`;

/** The same month, one step earlier or later. */
export const shiftMonth = (firstOfMonth: string, months: number): string => {
  const [year, month] = firstOfMonth.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + months, 1));
  return shifted.toISOString().slice(0, 10);
};
