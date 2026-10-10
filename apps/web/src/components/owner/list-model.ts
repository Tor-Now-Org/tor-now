import { bufferOf } from "./buffer.ts";

/**
 * What the business's lists say, worked out apart from React so every case is
 * a test: the line under a service, the order and letters of a customer list,
 * the counts on its filter, and how a customer's appointments fold.
 */

type Fill = (template: string, values: Readonly<Record<string, string>>) => string;
const fill: Fill = (template, values) => template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

export type ServiceLineWords = {
  readonly minutes: string;
  readonly noPrice: string;
  readonly recovery: string;
  readonly recoveryBusiness: string;
};

/**
 * What a customer is offered, as the row under a service's name says it: its
 * length, its price — "בלי מחיר" rather than a dash for a free one — and the
 * recovery after it, its own or the business's, when there is any.
 */
export const serviceLine = (
  service: { readonly durationMinutes: number; readonly priceMinor: number; readonly bufferMinutes: number | null },
  businessDefault: number,
  words: ServiceLineWords,
  price: (minor: number) => string,
): string => {
  const parts = [
    fill(words.minutes, { n: String(service.durationMinutes) }),
    service.priceMinor === 0 ? words.noPrice : price(service.priceMinor),
  ];
  const buffer = bufferOf(service.bufferMinutes, businessDefault);
  if (buffer.minutes > 0) {
    parts.push(fill(buffer.follows ? words.recoveryBusiness : words.recovery, { n: String(buffer.minutes) }));
  }
  return parts.join(" · ");
};

/** How many appointments a calendar still has coming, said as a person would. */
export const upcomingLine = (
  count: number | undefined,
  words: { readonly upcomingMany: string; readonly upcomingOne: string; readonly upcomingNone: string },
): string | null => {
  // An API from before the count sends nothing, and nothing is not "none".
  if (count === undefined) return null;
  if (count <= 0) return words.upcomingNone;
  if (count === 1) return words.upcomingOne;
  return fill(words.upcomingMany, { n: String(count) });
};

/** People in the order a phone book keeps them, in the reader's language. */
export const byName = <T extends { readonly name: string }>(people: readonly T[], language: "he" | "en"): T[] => {
  const collator = new Intl.Collator(language === "he" ? "he" : "en", { sensitivity: "base", numeric: true });
  return [...people].sort((a, b) => collator.compare(a.name.trim(), b.name.trim()));
};

/** Past this many, a list is split by first letter; under it, letters are clutter. */
export const LETTERS_FROM = 13;

export type Lettered<T> = { readonly kind: "letter"; readonly text: string } | { readonly kind: "row"; readonly item: T };

/** The first letter a name is filed under: a letter, or "#" for anything else. */
export const letterOf = (name: string): string => {
  const first = Array.from(name.trim())[0] ?? "";
  return /\p{L}/u.test(first) ? first.toLocaleUpperCase() : "#";
};

/**
 * The list with a heading before each new first letter — only once it is long
 * enough to need finding things in. Expects the list already in order.
 */
export const withLetters = <T extends { readonly name: string }>(
  people: readonly T[],
  from: number = LETTERS_FROM,
): Lettered<T>[] => {
  if (people.length < from) return people.map((item) => ({ kind: "row", item }));
  const out: Lettered<T>[] = [];
  let last: string | null = null;
  for (const item of people) {
    const letter = letterOf(item.name);
    if (letter !== last) {
      out.push({ kind: "letter", text: letter });
      last = letter;
    }
    out.push({ kind: "row", item });
  }
  return out;
};

/** How many each filter holds, so the filter can say so. */
export const standingCounts = (customers: readonly { readonly blocked: boolean }[]) => {
  const blocked = customers.filter((customer) => customer.blocked).length;
  return { all: customers.length, active: customers.length - blocked, blocked };
};

/** Up to this many upcoming appointments are all shown; past it, the rest fold. */
export const UPCOMING_SHOWN = 3;

/**
 * A customer's appointments still to come, as the card shows them: the first
 * few always, the rest only once asked for. `folded` is how many are behind
 * "עוד N", zero when nothing is folded away.
 */
export const upcomingShown = <T>(upcoming: readonly T[], open: boolean, shown: number = UPCOMING_SHOWN) => {
  const fits = upcoming.length <= shown;
  return {
    next: upcoming[0] ?? null,
    rest: fits || open ? upcoming.slice(1) : upcoming.slice(1, shown),
    folded: fits || open ? 0 : upcoming.length - shown,
    foldable: !fits,
  };
};

/** Past this many visits, a history is split by month. */
export const MONTHS_FROM = 13;

export type Monthed<T> = { readonly kind: "month"; readonly text: string } | { readonly kind: "row"; readonly item: T };

/**
 * A history, newest first, with a heading before each month once it is long
 * enough to need one. `monthOf` names an item's month in the reader's language.
 */
export const withMonths = <T>(history: readonly T[], monthOf: (item: T) => string, from: number = MONTHS_FROM): Monthed<T>[] => {
  if (history.length < from) return history.map((item) => ({ kind: "row", item }));
  const out: Monthed<T>[] = [];
  let last: string | null = null;
  for (const item of history) {
    const month = monthOf(item);
    if (month !== last) {
      out.push({ kind: "month", text: month });
      last = month;
    }
    out.push({ kind: "row", item });
  }
  return out;
};
