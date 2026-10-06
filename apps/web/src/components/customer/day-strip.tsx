"use client";

import { useEffect, useRef } from "react";
import { formatLocalDate, weekdayOf } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { dayName, markAria, markText } from "./day-words.ts";
import type { Mark, Opening, PartChoice } from "./days-model.ts";

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
 * it is in sight, and with the month, when the window runs past it.
 */
export const DayStrip = ({
  dates,
  marks,
  today,
  selected,
  part,
  onSelect,
  nextOpening,
  onMonth,
}: {
  dates: readonly string[];
  marks: Readonly<Record<string, Mark>>;
  today: string;
  selected: string;
  part: PartChoice;
  onSelect: (date: string) => void;
  /** The first date past the window, when the strip reaches the window's end. */
  nextOpening: { date: string; when: Opening } | null;
  /** Opens the month; absent when the strip already holds the whole window. */
  onMonth: (() => void) | null;
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
              aria-label={`${name}, ${markAria(mark, part, words, language)}`}
              className={`day-chip ${toneOf(mark)}`}
              onClick={() => onSelect(date)}
            >
              <span className="w">{date === today ? customer.today : (customer.days[weekdayOf(date)] ?? "")}</span>
              <span className="n">{formatLocalDate(date, language, { day: "numeric", month: "numeric" })}</span>
              <span className="c">
                {mark.kind === "loading" ? <span className="wait-line" aria-hidden="true" /> : markText(mark, part, words, language)}
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
        {onMonth !== null && (
          <button type="button" className="day-tile" onClick={onMonth} aria-haspopup="dialog">
            {words.wholeMonth}
          </button>
        )}
      </div>
    </div>
  );
};

/** "When suits you" — one choice that every day's count, and the times shown, follow. */
export const PartChoiceRow = ({
  part,
  onChange,
}: {
  part: PartChoice;
  onChange: (part: PartChoice) => void;
}) => {
  const words = useCopy("days");
  const customer = useCopy("customer");
  const names: Readonly<Record<PartChoice, string>> = {
    any: words.anyTime,
    morning: customer.morning,
    noon: customer.noon,
    evening: customer.evening,
  };
  return (
    <div className="part-choice" role="radiogroup" aria-label={words.whenSuits}>
      {(["any", "morning", "noon", "evening"] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={choice === part}
          className="chip"
          onClick={() => onChange(choice)}
        >
          {names[choice]}
        </button>
      ))}
    </div>
  );
};
