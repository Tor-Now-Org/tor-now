import { formatLocalDate, weekdayOf } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import type { DICTIONARIES, Language } from "@/lib/i18n/dictionaries.ts";
import type { Mark, Opening, PartChoice } from "./days-model.ts";

/** ADR 0026: the words a day says, as pure functions of its mark. */
type Words = { readonly [Key in keyof (typeof DICTIONARIES)["days"]["he"]]: string };

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "numeric" };

const partWord = (part: PartChoice, words: Words): string =>
  part === "morning" ? words.inMorning : part === "noon" ? words.inNoon : part === "evening" ? words.inEvening : "";

/** "בהמשך היום", "מחר", or "ב-21.10" — for a sentence. */
export const openingText = (when: Opening, words: Words, language: Language): string =>
  when.kind === "today"
    ? words.laterToday
    : when.kind === "tomorrow"
      ? words.tomorrow
      : fillText(words.onDate, { date: formatLocalDate(when.date, language, SHORT_DATE) });

/** "היום", "מחר", or "21.10" — for the few characters under a date. */
const openingShort = (when: Opening, words: Words, language: Language): string =>
  when.kind === "today"
    ? words.todayShort
    : when.kind === "tomorrow"
      ? words.tomorrow
      : formatLocalDate(when.date, language, SHORT_DATE);

export const markText = (mark: Mark, part: PartChoice, words: Words, language: Language): string => {
  switch (mark.kind) {
    case "free":
      if (part !== "any") return fillText(words.markPart, { count: String(mark.count), part: partWord(part, words) });
      return mark.count === 1 ? words.markFreeOne : fillText(words.markFree, { count: String(mark.count) });
    case "noneThen":
      return fillText(words.markNoneThen, { part: partWord(part, words) });
    case "full":
      return words.markFull;
    case "closed":
      return words.markClosed;
    case "call":
      return words.markCall;
    case "over":
      return words.markOver;
    case "later":
      return fillText(words.markLater, { when: openingShort(mark.when, words, language) });
    case "loading":
      return "";
  }
};

export const markAria = (mark: Mark, part: PartChoice, words: Words, language: Language): string => {
  const inPart = partWord(part, words);
  switch (mark.kind) {
    case "free":
      if (part !== "any") {
        return mark.count === 1
          ? fillText(words.ariaPartOne, { part: inPart })
          : fillText(words.ariaPart, { count: String(mark.count), part: inPart });
      }
      return mark.count === 1 ? words.ariaFreeOne : fillText(words.ariaFree, { count: String(mark.count) });
    case "noneThen":
      return fillText(words.ariaNoneThen, { part: inPart });
    case "full":
      return words.ariaFull;
    case "closed":
      return words.ariaClosed;
    case "call":
      return words.ariaCall;
    case "over":
      return words.ariaOver;
    case "later":
      return fillText(words.ariaLater, { when: openingText(mark.when, words, language) });
    case "loading":
      return words.ariaLoading;
  }
};

/** "היום 6.10", "יום שלישי 13.10", "Tuesday 13/10". */
export const dayName = (
  date: string,
  today: string,
  weekdays: readonly string[],
  todayWord: string,
  words: Words,
  language: Language,
): string => {
  const short = formatLocalDate(date, language, SHORT_DATE);
  if (date === today) return `${todayWord} ${short}`;
  return `${fillText(words.weekdayName, { weekday: weekdays[weekdayOf(date)] ?? "" })} ${short}`;
};
