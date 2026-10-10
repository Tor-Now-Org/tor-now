import { categoryLabel, mergedRanges, type BusinessCategory, type TimeRange } from "@tor-now/domain";
import type { Language } from "@/lib/i18n/dictionaries.ts";
import type { DayHours } from "./week.ts";

/**
 * What the screen after the wizard says about the Business it just opened.
 *
 * Read-only, and read from what the wizard saved: a summary of what customers
 * now see, never a second form. Pure, so every case the screen can be in is a
 * test rather than a screenshot.
 */

/** The first few of a list, and how many more there are. */
export const firstAndMore = <T>(items: readonly T[], shown: number): { shown: T[]; more: number } => ({
  shown: items.slice(0, Math.max(0, shown)),
  more: Math.max(0, items.length - Math.max(0, shown)),
});

/** The names that were typed, trimmed; a blank row was never saved. */
export const namedOnly = (names: readonly string[]): string[] =>
  names.map((name) => name.trim()).filter((name) => name.length > 0);

/** Days that keep the same hours, and those hours. */
export type HoursGroup = { readonly days: readonly number[]; readonly ranges: readonly TimeRange[] };

const shapeOf = (ranges: readonly TimeRange[]): string =>
  ranges.map((range) => `${range.start}-${range.end}`).join(",");

/**
 * The week as a person reads it: the open days grouped by the hours they keep,
 * in the order of the first day of each group. A closed week has no groups.
 */
export const hoursGroups = (week: readonly DayHours[]): HoursGroup[] => {
  const groups = new Map<string, { days: number[]; ranges: TimeRange[] }>();
  week.forEach((day, dayOfWeek) => {
    if (!day.open) return;
    const ranges = mergedRanges(day.ranges);
    if (ranges.length === 0) return;
    const shape = shapeOf(ranges);
    const existing = groups.get(shape);
    groups.set(
      shape,
      existing === undefined
        ? { days: [dayOfWeek], ranges }
        : { days: [...existing.days, dayOfWeek], ranges: existing.ranges },
    );
  });
  return [...groups.values()].sort((a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0));
};

/** Three days running or more read as a span ("א׳–ה׳"); fewer are listed. */
const SHORTEST_SPAN = 3;

/** The days of a group, said the way a sign on a door says them. */
export const daysText = (days: readonly number[], names: readonly string[]): string => {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs = sorted.reduce<number[][]>((all, day) => {
    const last = all.at(-1);
    return last !== undefined && last.at(-1) === day - 1
      ? [...all.slice(0, -1), [...last, day]]
      : [...all, [day]];
  }, []);
  const name = (day: number) => names[day] ?? String(day);
  return runs
    .map((run) =>
      run.length >= SHORTEST_SPAN
        ? `${name(run[0] ?? 0)}–${name(run.at(-1) ?? 0)}`
        : run.map(name).join(", "),
    )
    .join(", ");
};

export const rangesText = (ranges: readonly TimeRange[]): string =>
  ranges.map((range) => `${range.start}–${range.end}`).join(", ");

/** The address customers open, the same one "see it as a customer" opens. */
export const businessUrl = (origin: string, businessId: string): string =>
  `${origin.replace(/\/+$/, "")}/business/${encodeURIComponent(businessId)}`;

/** WhatsApp with the message ready and nobody chosen: the owner picks who. */
export const whatsappShareLink = (message: string): string =>
  `https://wa.me/?text=${encodeURIComponent(message)}`;

/** A file name a printing shop will not choke on. */
export const cardFileName = (name: string): string => {
  const slug = name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `qr-${slug === "" ? "business" : slug}.png`;
};

/** What a share hands on: the link, the name, and the card's own language and line. */
export type Shared = {
  readonly url: string;
  readonly name: string;
  /** The language the printed card is set in: the app's. */
  readonly cardLanguage: Language;
  /** The main category and the address, already in the card's language. */
  readonly kind: string;
};

/** The main category and the address, as one line, in one language. */
export const kindLine = (category: BusinessCategory | null, address: string | null, language: Language): string =>
  [category === null ? null : categoryLabel(category, language), address]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .map((part) => part.trim())
    .join(" · ");

/** A business as a share hands it on, wherever the share starts. */
export const sharedOf = (
  business: { readonly id: string; readonly name: string; readonly address: string | null; readonly category: BusinessCategory | null },
  origin: string,
  appLanguage: Language,
): Shared => {
  // The card speaks the app's language: whoever shares from a Hebrew app
  // prints a Hebrew card, whatever letters the business's name is in.
  const cardLanguage = appLanguage;
  return {
    url: businessUrl(origin, business.id),
    name: business.name,
    cardLanguage,
    kind: kindLine(business.category, business.address, cardLanguage),
  };
};
