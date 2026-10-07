"use client";

import { useEffect, useRef } from "react";
import { formatLocalDate, weekdayOf } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { dayName, markAria, markText } from "./day-words.ts";
import type { Mark, Opening } from "./days-model.ts";

/** How a mark is drawn: an open day, a full one, or a quiet one with nothing to book. */
const toneOf = (mark: Mark): string =>
  mark.kind === "free" || mark.kind === "loading"
    ? ""
    : mark.kind === "full"
      ? "full"
      : mark.kind === "call"
        ? "off call"
        : "off";

/**
 * ADR 0026: the days, each saying what it holds. Every day stays a choice —
 * a full day leads to the waiting list and a "by phone" day to the phone — so
 * nothing here is disabled. The strip ends with the day after the window, when
 * it is in sight. The month is reached from the heading above, not the strip's end.
 */
export const DayStrip = ({
  dates,
  marks,
  today,
  selected,
  onSelect,
  nextOpening,
}: {
  dates: readonly string[];
  marks: Readonly<Record<string, Mark>>;
  today: string;
  selected: string;
  onSelect: (date: string) => void;
  /** The first date past the window, when the strip reaches the window's end. */
  nextOpening: { date: string; when: Opening } | null;
}) => {
  const words = useCopy("days");
  const customer = useCopy("customer");
  const { language } = useLanguage();
  const strip = useRef<HTMLDivElement>(null);

  // The chosen day is always in sight, including one picked from the month.
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(`[data-date="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected, dates.length]);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <div ref={strip} className="day-strip" role="radiogroup" aria-label={words.dayStrip} style={{ flex: 1 }}>
        {dates.map((date) => {
          const mark = marks[date] ?? { kind: "loading" };
          const name = dayName(date, today, customer.days, customer.today, words, language);
          return (
            <button
              key={date}
              type="button"
              role="radio"
              data-date={date}
              aria-checked={date === selected}
              aria-label={`${name}, ${markAria(mark, words, language)}`}
              className={`day-chip ${toneOf(mark)}`}
              onClick={() => onSelect(date)}
            >
              <span className="w">{date === today ? customer.today : (customer.days[weekdayOf(date)] ?? "")}</span>
              <span className="n">{formatLocalDate(date, language, { day: "numeric", month: "numeric" })}</span>
              <span className="c">
                {mark.kind === "loading" ? <span className="wait-line" aria-hidden="true" /> : markText(mark, words, language)}
              </span>
            </button>
          );
        })}
        {nextOpening !== null && (
          <div className="day-tile" role="note">
            <span className="n">{formatLocalDate(nextOpening.date, language, { day: "numeric", month: "numeric" })}</span>
            <span className="c">
              {fillText(words.markLater, {
                when: nextOpening.when.kind === "tomorrow" ? words.tomorrow : words.todayShort,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
