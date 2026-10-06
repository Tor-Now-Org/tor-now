"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DayAvailabilityDto } from "@/lib/api/types.ts";
import { addDaysTo, formatLocalDate, monthName } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Note, Sheet } from "../ui.tsx";
import { dayName, markAria, openingText } from "./day-words.ts";
import {
  cellOf,
  markOf,
  monthSpan,
  monthWeeks,
  monthsOf,
  whenOpens,
  type Mark,
} from "./days-model.ts";

/** A Sunday, from which the week's narrow day names are read in the reader's language. */
const A_SUNDAY = "2026-10-04";
const WEEK = 7;

const toneOf = (mark: Mark): string =>
  mark.kind === "full" ? "full" : mark.kind === "call" ? "off call" : mark.kind === "free" || mark.kind === "loading" ? "" : "off";

/**
 * ADR 0026: "כל החודש". The window's months, each day saying what it holds,
 * as far as the window reaches and no further; a day past it says when it
 * opens. Picking an open day closes the sheet on that day.
 */
export const MonthSheet = ({
  open,
  onClose,
  today,
  lastDay,
  selected,
  days,
  timeZone,
  horizonDays,
  ensure,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  lastDay: string;
  selected: string;
  days: Readonly<Record<string, DayAvailabilityDto>>;
  timeZone: string;
  horizonDays: number;
  ensure: (from: string, to: string) => Promise<void>;
  onPick: (date: string) => void;
}) => {
  const words = useCopy("days");
  const customer = useCopy("customer");
  const { language } = useLanguage();
  const months = monthsOf(today, lastDay);
  const [index, setIndex] = useState(0);
  const [later, setLater] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  /** A day the arrow keys moved to in a month not drawn yet. */
  const pendingFocus = useRef<string | null>(null);

  // Opens on the month of the day being looked at.
  useEffect(() => {
    if (!open) return;
    const at = months.indexOf(`${selected.slice(0, 7)}-01`);
    setIndex(at < 0 ? 0 : at);
    setLater(null);
    // Only on opening: paging within the sheet must not snap back to the
    // chosen day's month, so the selection is read here and not depended on.
  }, [open]);

  const month = months[Math.min(index, months.length - 1)] ?? months[0]!;

  useEffect(() => {
    if (!open) return;
    const span = monthSpan(month, today, lastDay);
    if (span !== null) void ensure(span.from, span.to);
  }, [open, month, today, lastDay, ensure]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    grid.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
  }, [month]);

  const monthOnly = (first: string) =>
    new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: "UTC" }).format(
      new Date(`${first}T12:00:00Z`),
    );
  const previous = addDaysTo(month, -1).slice(0, 8) + "01";
  const following = addDaysTo(month, 32).slice(0, 8) + "01";

  const narrow = new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", { weekday: "narrow", timeZone: "UTC" });
  const headings = Array.from({ length: WEEK }, (_unused, day) =>
    narrow.format(new Date(`${addDaysTo(A_SUNDAY, day)}T12:00:00Z`)),
  );

  /** Arrow keys move by a day or a week, the way the grid reads in this language. */
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).dataset["date"];
    if (from === undefined) return;
    const forward = language === "he" ? "ArrowLeft" : "ArrowRight";
    const back = language === "he" ? "ArrowRight" : "ArrowLeft";
    const step =
      event.key === forward ? 1 : event.key === back ? -1 : event.key === "ArrowDown" ? WEEK : event.key === "ArrowUp" ? -WEEK : 0;
    if (step === 0) return;
    event.preventDefault();
    const target = addDaysTo(from, step);
    if (target < today) return;
    const targetMonth = months.indexOf(`${target.slice(0, 7)}-01`);
    if (targetMonth < 0) return;
    if (targetMonth === index) {
      grid.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
      return;
    }
    pendingFocus.current = target;
    setIndex(targetMonth);
  };

  const cell = (date: string | null, position: number) => {
    if (date === null) return <span key={`blank-${position}`} className="month-cell blank" aria-hidden="true" />;
    const number = Number(date.slice(8));
    const kind = cellOf(date, today, lastDay);
    if (kind === "past") {
      return (
        <span key={date} className="month-cell past" aria-hidden="true">
          {number}
        </span>
      );
    }
    const name = dayName(date, today, customer.days, customer.today, words, language);
    if (kind === "later") {
      const when = whenOpens(date, today, horizonDays);
      return (
        <button
          key={date}
          type="button"
          data-date={date}
          className="month-cell later"
          aria-pressed={later === date}
          aria-label={`${name}, ${fillText(words.ariaLater, { when: openingText(when, words, language) })}`}
          onClick={() => setLater(date)}
        >
          {number}
        </button>
      );
    }
    const mark = markOf(days[date], today, horizonDays);
    const short =
      mark.kind === "free"
        ? String(mark.count)
        : mark.kind === "full"
          ? words.markFull
          : mark.kind === "closed"
            ? words.markClosed
            : mark.kind === "call"
              ? words.markCall
              : mark.kind === "over"
                ? words.markOver
                : "";
    return (
      <button
        key={date}
        type="button"
        data-date={date}
        className={`month-cell ${toneOf(mark)}`}
        {...(date === selected ? { "aria-current": "date" as const } : {})}
        aria-label={`${name}, ${markAria(mark, words, language)}`}
        onClick={() => onPick(date)}
      >
        {number}
        <i aria-hidden="true">{short}</i>
      </button>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="month-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Each arrow names the month it goes to. The chevrons are the same
            characters in both languages: right-to-left text mirrors them. */}
        <div className="month-head">
          <button
            type="button"
            onClick={() => {
              setIndex(index - 1);
              setLater(null);
            }}
            disabled={index === 0}
            aria-label={words.previousMonth}
          >
            ‹ {monthOnly(previous)}
          </button>
          <h2 id="month-title" aria-live="polite">
            {monthName(month, timeZone, language)}
          </h2>
          <button
            type="button"
            onClick={() => {
              setIndex(index + 1);
              setLater(null);
            }}
            disabled={index >= months.length - 1}
            aria-label={words.nextMonth}
          >
            {monthOnly(following)} ›
          </button>
        </div>
        <div ref={grid} className="month-grid" role="group" aria-label={words.monthTitle} onKeyDown={move}>
          {headings.map((heading, day) => (
            <span key={`h-${day}`} className="h" aria-hidden="true">
              {heading}
            </span>
          ))}
          {monthWeeks(month).flat().map(cell)}
        </div>
        {later !== null && (
          <Note>
            {fillText(words.laterNote, {
              date: formatLocalDate(later, language, { day: "numeric", month: "numeric" }),
              when: openingText(whenOpens(later, today, horizonDays), words, language),
            })}
          </Note>
        )}
        <div className="month-legend" aria-hidden="true">
          <span>{words.legendFree}</span>
          <span className="lf">{words.legendFull}</span>
          <span className="lo">{words.legendClosed}</span>
          {months.at(-1) === month && <span className="ll">{words.legendLater}</span>}
        </div>
      </div>
    </Sheet>
  );
};
