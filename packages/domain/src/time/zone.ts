import { validationFailed } from "../shared/errors.ts";
import { instant, type Instant } from "./instant.ts";
import { localDateOf, type LocalDate } from "./local-date.ts";
import { localTimeOf, type LocalTime } from "./local-time.ts";
import { MILLISECONDS_PER_MINUTE } from "../shared/constants.ts";

/**
 * An IANA timezone identifier. A Business owns one, and it is the only bridge
 * between the Local Times of its recurring rules and the Instants of its
 * Appointments.
 */
export type TimeZone = string & { readonly __brand: "TimeZone" };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (zone: TimeZone): Intl.DateTimeFormat => {
  const cached = formatterCache.get(zone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(zone, created);
  return created;
};

export const timeZone = (identifier: string): TimeZone => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier });
  } catch {
    throw validationFailed(`"${identifier}" is not a known timezone`);
  }
  return identifier as TimeZone;
};

export type ZonedDateTime = { date: LocalDate; time: LocalTime };

type Fields = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const fieldsAt = (value: Instant, zone: TimeZone): Fields => {
  const parts = formatterFor(zone).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    /* istanbul ignore next -- every requested field is configured above */
    if (part === undefined) throw new Error(`Missing ${type} from formatter`);
    return Number(part.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some engines render midnight as "24" under hour12:false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
};

/** The zone's offset from UTC, in milliseconds, at a given instant. */
const offsetAt = (value: Instant, zone: TimeZone): number => {
  const f = fieldsAt(value, zone);
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asIfUtc - value;
};

/** Reads the wall-clock date and time a Business would see at an instant. */
export const instantToZoned = (
  value: Instant,
  zone: TimeZone,
): ZonedDateTime => {
  const f = fieldsAt(value, zone);
  return {
    date: localDateOf(f.year, f.month, f.day),
    time: localTimeOf(f.hour, f.minute),
  };
};

/**
 * Resolves a wall-clock date and time in a zone to the absolute instant it
 * names. The offset is applied and then re-read, because the offset that
 * applies is the one in force at the resulting instant, not at the guess — the
 * two differ across a daylight-saving transition.
 *
 * Times skipped by a spring-forward transition have no instant; they resolve to
 * the moment the clocks jumped to. Times repeated by an autumn transition
 * resolve to the first of the two.
 */
export const zonedToInstant = (
  date: LocalDate,
  time: LocalTime,
  zone: TimeZone,
): Instant => {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const asIfUtc = Date.UTC(year, month - 1, day) + time * MILLISECONDS_PER_MINUTE;
  const firstGuess = instant(asIfUtc - offsetAt(instant(asIfUtc), zone));
  return instant(asIfUtc - offsetAt(firstGuess, zone));
};

export const todayIn = (value: Instant, zone: TimeZone): LocalDate =>
  instantToZoned(value, zone).date;
