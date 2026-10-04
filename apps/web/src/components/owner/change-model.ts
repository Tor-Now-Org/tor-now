import type { ChangeDto, ChangeOutcome, ChangeScopeDto, ClockRange } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";

/**
 * "שינוי ביומן", the rules the sheet follows, apart from the screen.
 *
 * Every door opens the same sheet; a door only fills in what it already knows.
 * Two questions, always in this order — for whom, and what happens — and the
 * button stays off until the second is answered, saying what it will do.
 */

export type Who = {
  /** An owner or a manager: every calendar, and the whole business. */
  readonly manages: boolean;
  /** The calendars on offer to this person, in the business's order. */
  readonly calendars: readonly { readonly id: string; readonly name: string }[];
};

export type ScopeOption =
  | { readonly kind: "BUSINESS" }
  | { readonly kind: "CALENDAR"; readonly resourceId: string; readonly name: string };

export type Door =
  /** Days chosen on the month after the +, with the calendar on screen if there is one. */
  | { readonly kind: "days"; readonly from: string; readonly to: string; readonly resourceId: string | null }
  /** A free stretch on the day. */
  | { readonly kind: "stretch"; readonly date: string; readonly resourceId: string; readonly start: string; readonly end: string }
  /** The schedule: dates typed rather than tapped. */
  | { readonly kind: "typed"; readonly date: string; readonly scope: ChangeScopeDto | null }
  /** A change already on the calendar, to be edited. */
  | { readonly kind: "edit"; readonly change: ChangeDto };

export type Draft = {
  readonly fromDate: string;
  readonly toDate: string;
  /** Whether the dates are typed in fields rather than fixed above. */
  readonly typing: boolean;
  readonly scope: ChangeScopeDto | null;
  readonly outcome: ChangeOutcome | null;
  readonly ranges: readonly ClockRange[];
  readonly note: string;
  readonly upcoming: "CANCEL" | "KEEP";
  readonly replacing: string | null;
  /** The hours a free stretch brought, offered first for part of the day. */
  readonly stretch: ClockRange | null;
  /** Set once the owner touched the hours; until then a new outcome refills them. */
  readonly touchedHours: boolean;
};

export type Problem =
  | "NO_SCOPE"
  | "NO_OUTCOME"
  | "NO_HOURS"
  | "MISSING_HOURS"
  | "END_BEFORE_START"
  | "OVERLAP"
  | "PAST_DAY"
  | "DATES_REVERSED"
  | "TOO_LONG";

/** The longest change made at once, as the API allows it. */
const MAX_DAYS = 366;
/** Where other hours start on a day nobody usually works. */
const A_WORKING_DAY: ClockRange = { start: "09:00", end: "17:00" };
/** Where part of the day starts when nothing says otherwise. */
const AN_HOUR_AT_NOON: ClockRange = { start: "12:00", end: "13:00" };
/** The short day and the late start the quick hours offer for other hours. */
const SHORT_DAY_ENDS = "13:00";
const LATE_START = "12:00";
const LAST_MINUTE = "23:59";

const minutesOf = (clock: string): number => {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const clockOf = (minutes: number): string => {
  const held = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return `${String(Math.floor(held / 60)).padStart(2, "0")}:${String(held % 60).padStart(2, "0")}`;
};

const isClock = (text: string) => /^\d{2}:\d{2}$/.test(text);

const sameScope = (left: ChangeScopeDto, right: ChangeScopeDto) =>
  left.kind === right.kind &&
  (left.kind === "BUSINESS" || (right.kind === "CALENDAR" && left.resourceId === right.resourceId));

/** For whom: this person's calendars, and the whole business for an owner or manager of several. */
export const scopeOptions = (who: Who): readonly ScopeOption[] => [
  ...who.calendars.map((calendar) => ({ kind: "CALENDAR" as const, resourceId: calendar.id, name: calendar.name })),
  ...(who.manages && who.calendars.length > 1 ? [{ kind: "BUSINESS" as const }] : []),
];

/** A scope this person may choose, or the one they are bound to, or none yet. */
const allowed = (wanted: ChangeScopeDto | null, who: Who): ChangeScopeDto | null => {
  const options = scopeOptions(who);
  const only = options.length === 1 ? options[0]! : null;
  const fallback = only === null ? null : only.kind === "BUSINESS" ? only : { kind: "CALENDAR" as const, resourceId: only.resourceId };
  if (wanted === null) return fallback;
  return options.some((option) => sameScope(option, wanted)) ? wanted : fallback;
};

const later = (left: string, right: string) => (left > right ? left : right);

/** What a door fills in; everything else waits for the owner. */
export const draftFor = (door: Door, who: Who, today: string): Draft => {
  const blank = {
    typing: false,
    outcome: null,
    ranges: [],
    note: "",
    upcoming: "CANCEL" as const,
    replacing: null,
    stretch: null,
    touchedHours: false,
  };
  switch (door.kind) {
    case "days":
      return {
        ...blank,
        fromDate: door.from,
        toDate: door.to,
        scope: allowed(door.resourceId === null ? null : { kind: "CALENDAR", resourceId: door.resourceId }, who),
      };
    case "stretch":
      return {
        ...blank,
        fromDate: door.date,
        toDate: door.date,
        scope: allowed({ kind: "CALENDAR", resourceId: door.resourceId }, who),
        stretch: { start: door.start, end: door.end },
      };
    case "typed":
      return { ...blank, typing: true, fromDate: door.date, toDate: door.date, scope: allowed(door.scope, who) };
    case "edit": {
      const { change } = door;
      const ahead = change.days.find((day) => day.date >= today) ?? change.days[0];
      return {
        ...blank,
        fromDate: later(change.fromDate, today),
        toDate: change.toDate,
        scope: change.scope,
        outcome: change.outcome,
        ranges: change.ranges ?? ahead?.ranges ?? [],
        note: change.note ?? "",
        replacing: change.id,
        touchedHours: true,
      };
    }
  }
};

const defaultHours = (outcome: ChangeOutcome, draft: Draft, usual: readonly ClockRange[]): readonly ClockRange[] => {
  if (outcome === "OFF_ALL_DAY") return [];
  if (outcome === "OTHER_HOURS") return usual.length > 0 ? usual : [A_WORKING_DAY];
  if (draft.stretch !== null) return [draft.stretch];
  const opening = usual[0];
  return opening === undefined
    ? [AN_HOUR_AT_NOON]
    : [{ start: opening.start, end: clockOf(Math.min(minutesOf(opening.start) + 60, minutesOf(opening.end))) }];
};

/** Choosing what happens; hours the owner already set are kept between the two outcomes that have them. */
export const withOutcome = (draft: Draft, outcome: ChangeOutcome, usual: readonly ClockRange[]): Draft => {
  if (outcome === "OFF_ALL_DAY") return { ...draft, outcome, ranges: [] };
  const keep = draft.touchedHours && draft.ranges.length > 0;
  return { ...draft, outcome, ranges: keep ? draft.ranges : defaultHours(outcome, draft, usual) };
};

/** The usual day arrived after other hours were chosen: start from it, unless hours were typed. */
export const withUsual = (draft: Draft, usual: readonly ClockRange[]): Draft =>
  draft.outcome === "OTHER_HOURS" && !draft.touchedHours && usual.length > 0 ? { ...draft, ranges: usual } : draft;

export type QuickChip = {
  readonly label: "quick30" | "quick60" | "quick120" | "quickToEnd" | "quickUntil" | "quickFrom" | "quickUsual";
  readonly time?: string;
  readonly apply: (ranges: readonly ClockRange[]) => readonly ClockRange[];
};

const firstRange = (ranges: readonly ClockRange[]): ClockRange => ranges[0] ?? AN_HOUR_AT_NOON;

/** The ordinary answers, one tap away. */
export const quickChips = (
  outcome: ChangeOutcome | null,
  usual: readonly ClockRange[],
): readonly QuickChip[] => {
  if (outcome === "OFF_PART") {
    const lasting = (minutes: number) => (current: readonly ClockRange[]) => {
      const first = firstRange(current);
      return [{ start: first.start, end: clockOf(minutesOf(first.start) + minutes) }, ...current.slice(1)];
    };
    const closing = usual.at(-1)?.end ?? LAST_MINUTE;
    return [
      { label: "quick30", apply: lasting(30) },
      { label: "quick60", apply: lasting(60) },
      { label: "quick120", apply: lasting(120) },
      {
        label: "quickToEnd",
        apply: (current) => [{ start: firstRange(current).start, end: closing === "24:00" ? LAST_MINUTE : closing }],
      },
    ];
  }
  if (outcome === "OTHER_HOURS") {
    const chips: QuickChip[] = [
      {
        label: "quickUntil",
        time: SHORT_DAY_ENDS,
        apply: (current) => {
          const kept = current.filter((range) => range.start < SHORT_DAY_ENDS);
          const base = kept.length > 0 ? kept : [A_WORKING_DAY];
          return base.map((range, index) => (index === base.length - 1 ? { ...range, end: SHORT_DAY_ENDS } : range));
        },
      },
      {
        label: "quickFrom",
        time: LATE_START,
        apply: (current) => {
          const kept = current.filter((range) => range.end > LATE_START);
          const base = kept.length > 0 ? kept : [A_WORKING_DAY];
          return base.map((range, index) => (index === 0 ? { ...range, start: LATE_START } : range));
        },
      },
    ];
    return usual.length > 0 ? [...chips, { label: "quickUsual", apply: () => usual }] : chips;
  }
  return [];
};

/** What holds saving back, in the order it should be said. */
export const problemsOf = (draft: Draft, today: string): readonly Problem[] => {
  const problems: Problem[] = [];
  if (draft.fromDate === "" || draft.toDate === "" || draft.toDate < draft.fromDate) problems.push("DATES_REVERSED");
  else if (draft.fromDate < today) problems.push("PAST_DAY");
  else if (daysBetween(draft.fromDate, draft.toDate) > MAX_DAYS) problems.push("TOO_LONG");
  if (draft.scope === null) problems.push("NO_SCOPE");
  if (draft.outcome === null) problems.push("NO_OUTCOME");
  if (draft.outcome === "OFF_PART" || draft.outcome === "OTHER_HOURS") {
    if (draft.ranges.length === 0) problems.push("NO_HOURS");
    else if (draft.ranges.some((range) => !isClock(range.start) || !isClock(range.end))) problems.push("MISSING_HOURS");
    else if (draft.ranges.some((range) => range.end <= range.start)) problems.push("END_BEFORE_START");
    else {
      const ordered = [...draft.ranges].sort((left, right) => left.start.localeCompare(right.start));
      if (ordered.some((range, index) => index > 0 && range.start < ordered[index - 1]!.end)) problems.push("OVERLAP");
    }
  }
  return problems;
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export type SaveLabel =
  | { readonly key: "chooseWho" | "chooseWhat" | "save" | "closeDay" | "closeDays" }
  | { readonly key: "saveAndCancel" | "saveAndCancelOne" | "closeAndCancel" | "closeAndCancelOne"; readonly count: number };

/** The button says what it will do: save, cancel so many, or close the business. */
export const saveLabel = (draft: Draft, stranded: number): SaveLabel => {
  if (draft.scope === null) return { key: "chooseWho" };
  if (draft.outcome === null) return { key: "chooseWhat" };
  const cancelling = draft.upcoming === "CANCEL" ? stranded : 0;
  const closing = draft.scope.kind === "BUSINESS" && draft.outcome === "OFF_ALL_DAY";
  if (cancelling > 0) {
    return closing
      ? { key: cancelling === 1 ? "closeAndCancelOne" : "closeAndCancel", count: cancelling }
      : { key: cancelling === 1 ? "saveAndCancelOne" : "saveAndCancel", count: cancelling };
  }
  if (closing) return { key: draft.fromDate === draft.toDate ? "closeDay" : "closeDays" };
  return { key: "save" };
};

type Words = {
  readonly calendarOf: string;
  readonly calendarNamed: string;
  readonly dOne: string;
  readonly dTwo: string;
  readonly dRange: string;
  readonly sOffAllDayCalendar: string;
  readonly sOffAllDayBusiness: string;
  readonly sOffPartCalendar: string;
  readonly sOffPartBusiness: string;
  readonly sOtherHoursCalendar: string;
  readonly sOtherHoursCalendarInstead: string;
  readonly sOtherHoursBusiness: string;
  readonly sOtherHoursBusinessInstead: string;
  readonly sDifferentHours: string;
  readonly sOffPartCalendarMixed: string;
  readonly sOffPartBusinessMixed: string;
  readonly sOtherHoursCalendarMixed: string;
  readonly sOtherHoursBusinessMixed: string;
  readonly othersAsUsual: string;
  readonly rowClosed: string;
  readonly rowOffAllDay: string;
  readonly rowOffPart: string;
  readonly rowHours: string;
  readonly rowDays: string;
};

const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/** A calendar the way a sentence says it: "ביומן של רן", or "ביומן א" for one already called a calendar. */
export const calendarPhrase = (name: string, words: Pick<Words, "calendarOf" | "calendarNamed">): string =>
  fill(/^יומן/.test(name) ? words.calendarNamed : words.calendarOf, { name });

export const hoursText = (ranges: readonly ClockRange[]): string =>
  ranges.map((range) => `${range.start}–${range.end}`).join(", ");

const dayAndMonth = (date: string, language: "he" | "en", month: "long" | "short" = "long") =>
  formatLocalDate(date, language, { day: "numeric", month });

const dayOnly = (date: string) => String(Number(date.slice(8, 10)));

/** One day, two days, or a run of them, said the way people say dates. */
export const datesPhrase = (from: string, to: string, language: "he" | "en", words: Pick<Words, "dOne" | "dTwo" | "dRange">): string => {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (from === to) return fill(words.dOne, { date: dayAndMonth(from, language) });
  const first = sameMonth ? dayOnly(from) : dayAndMonth(from, language);
  const second = dayAndMonth(to, language);
  return daysBetween(from, to) === 2
    ? fill(words.dTwo, { first, second })
    : fill(words.dRange, { first, last: second });
};

export type Sentence = {
  readonly text: string;
  /** The facts in it, which the screen sets in bold. */
  readonly filled: readonly string[];
  /** The same sentence with its facts as placeholders, for a screen that marks them. */
  readonly template: string;
  readonly values: Readonly<Record<string, string>>;
};

/** The result in plain words, before anything is saved; the same words a change shows afterwards. */
export const sentenceOf = (
  input: {
    readonly scope: ChangeScopeDto | null;
    readonly outcome: ChangeOutcome | null;
    readonly fromDate: string;
    readonly toDate: string;
    /** Null when the days keep different hours. */
    readonly ranges: readonly ClockRange[] | null;
    readonly usual: readonly ClockRange[];
    /** How many calendars the business has on offer to this person. */
    readonly calendars: number;
  },
  words: Words,
  language: "he" | "en",
  names: Readonly<Record<string, string>>,
): Sentence | null => {
  const { scope, outcome } = input;
  if (scope === null || outcome === null || input.fromDate === "" || input.toDate === "") return null;
  const dates = datesPhrase(input.fromDate, input.toDate, language, words);
  const calendar = scope.kind === "CALENDAR" ? calendarPhrase(names[scope.resourceId] ?? "", words) : "";
  const mixed = input.ranges === null;
  const hours = mixed ? words.sDifferentHours : hoursText(input.ranges ?? []);
  const usual = hoursText(input.usual);
  const business = scope.kind === "BUSINESS";

  const template =
    outcome === "OFF_ALL_DAY"
      ? business ? words.sOffAllDayBusiness : words.sOffAllDayCalendar
      : outcome === "OFF_PART"
        ? business
          ? mixed ? words.sOffPartBusinessMixed : words.sOffPartBusiness
          : mixed ? words.sOffPartCalendarMixed : words.sOffPartCalendar
        : business
          ? mixed ? words.sOtherHoursBusinessMixed : usual === "" ? words.sOtherHoursBusiness : words.sOtherHoursBusinessInstead
          : mixed ? words.sOtherHoursCalendarMixed : usual === "" ? words.sOtherHoursCalendar : words.sOtherHoursCalendarInstead;

  const values = { dates, calendar, hours, usual };
  const others = !business && outcome === "OFF_ALL_DAY" && input.calendars > 1 ? ` ${words.othersAsUsual}` : "";
  const filled = [dates, calendar, mixed ? "" : outcome === "OFF_ALL_DAY" ? "" : hours].filter((part) => part !== "");
  return { text: fill(template, values) + others, filled, template: template + others, values };
};

export type Mark = "CLOSED" | "PART" | "HOURS";

/** One set of marks everywhere, named by what happens. */
export const markOf = (change: Pick<ChangeDto, "outcome">): Mark =>
  change.outcome === "OFF_ALL_DAY" ? "CLOSED" : change.outcome === "OFF_PART" ? "PART" : "HOURS";

const shortDates = (from: string, to: string, language: "he" | "en"): string => {
  if (from === to) return dayAndMonth(from, language, "short");
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${dayOnly(from)}–${dayAndMonth(to, language, "short")}`
    : `${dayAndMonth(from, language, "short")}–${dayAndMonth(to, language, "short")}`;
};

/** A change as a short row of the schedule's list. */
export const rowOf = (change: ChangeDto, words: Words, language: "he" | "en") => {
  const days = change.days.length;
  const hours = change.ranges === null ? words.sDifferentHours : hoursText(change.ranges);
  const what =
    change.outcome === "OFF_ALL_DAY"
      ? change.scope.kind === "BUSINESS" ? words.rowClosed : words.rowOffAllDay
      : fill(change.outcome === "OFF_PART" ? words.rowOffPart : words.rowHours, { hours });
  return {
    when: shortDates(change.fromDate, change.toDate, language),
    what: days > 1 && change.outcome === "OFF_ALL_DAY" ? `${what} · ${fill(words.rowDays, { count: String(days) })}` : what,
    note: change.note,
  };
};

/** Whether this person may edit or remove a change: the business's is an owner's or a manager's. */
export const mayChange = (change: Pick<ChangeDto, "scope">, who: Who): boolean =>
  change.scope.kind === "BUSINESS"
    ? who.manages
    : who.calendars.some((calendar) => calendar.id === (change.scope as { resourceId: string }).resourceId);

/**
 * Other hours that are the very hours the days usually keep change nothing, and
 * saving them would only write a day identical to itself. The sheet says so in
 * place of the sentence, and holds saving back; an edit is pointed at removing
 * the change, which is what giving a day back its usual hours is.
 */
export const noChangeOf = (
  draft: Pick<Draft, "outcome" | "fromDate" | "toDate" | "replacing">,
  sameAsUsual: boolean | undefined,
): { readonly key: "sameAsUsualDay" | "sameAsUsualDays"; readonly backToUsual: boolean } | null =>
  draft.outcome === "OTHER_HOURS" && sameAsUsual === true
    ? { key: draft.fromDate === draft.toDate ? "sameAsUsualDay" : "sameAsUsualDays", backToUsual: draft.replacing !== null }
    : null;
