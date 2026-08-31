"use client";

import { addDaysTo, formatLocalDate, weekdayOf } from "@/lib/format.ts";
import { useLanguage } from "@/lib/i18n/index.tsx";

/**
 * The horizontal run of days a customer picks from. It never runs past the
 * Business's booking horizon (ADR 0012), because a day beyond it can only ever
 * answer "not yet" — offering it would be offering a dead end.
 */
export const DateStrip = ({
  from,
  days,
  selected,
  onSelect,
  todayLabel,
  weekdayNames,
}: {
  from: string;
  days: number;
  selected: string;
  onSelect: (date: string) => void;
  todayLabel: string;
  weekdayNames: readonly string[];
}) => {
  const { language } = useLanguage();
  const dates = Array.from({ length: days }, (_unused, index) =>
    addDaysTo(from, index),
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        padding: "2px 0 6px",
        scrollbarWidth: "none",
      }}
      className="scroll"
      role="radiogroup"
      aria-label={todayLabel}
    >
      {dates.map((date, index) => {
        const active = date === selected;
        const weekday = weekdayNames[weekdayOf(date)] ?? "";
        return (
          <button
            key={date}
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(date)}
            style={{
              flexDirection: "column",
              gap: 2,
              minWidth: 58,
              minHeight: 62,
              borderRadius: 14,
              border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
              background: active ? "var(--accent)" : "var(--raised)",
              color: active ? "var(--on-accent)" : "var(--ink)",
              padding: "8px 6px",
            }}
          >
            <span style={{ fontSize: 11.5, opacity: 0.85 }}>
              {index === 0 ? todayLabel : weekday}
            </span>
            <span
              className="tab"
              style={{ fontSize: 15, fontFamily: "Rubik, sans-serif", fontWeight: 600 }}
            >
              {formatLocalDate(date, language, { day: "numeric", month: "numeric" })}
            </span>
          </button>
        );
      })}
    </div>
  );
};
