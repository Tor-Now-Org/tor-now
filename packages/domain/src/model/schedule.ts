import type { Instant } from "../time/instant.ts";
import type { DayOfWeek, LocalDate } from "../time/local-date.ts";
import type { LocalTime } from "../time/local-time.ts";
import type {
  BlockId,
  BusinessId,
  DateOverrideId,
  ResourceId,
  WorkingHoursId,
} from "./ids.ts";

/**
 * The three schedule layers of ADR 0002. Each has exactly one meaning, and
 * nothing else expresses availability.
 */

/**
 * Layer one, recurring: when a Resource is open on a given weekday. Several
 * rows per weekday express several ranges, and the gaps between them are the
 * Resource's breaks — there is no break entity.
 */
export type WorkingHours = {
  readonly id: WorkingHoursId;
  readonly resourceId: ResourceId;
  readonly businessId: BusinessId;
  readonly dayOfWeek: DayOfWeek;
  readonly start: LocalTime;
  readonly end: LocalTime;
};

/**
 * Layer two, per date: a replacement for one date's Working Hours. Its
 * presence is what overrides the weekday; `ranges` being empty is how a day
 * off is expressed, which is why the date and its ranges are one value rather
 * than a row per range with a nullable time.
 */
export type DateOverride = {
  readonly id: DateOverrideId;
  readonly resourceId: ResourceId;
  readonly businessId: BusinessId;
  readonly date: LocalDate;
  readonly note: string | null;
  readonly ranges: readonly LocalTimeRangeValue[];
};

export type LocalTimeRangeValue = {
  readonly start: LocalTime;
  readonly end: LocalTime;
};

export const isClosedOverride = (override: DateOverride): boolean =>
  override.ranges.length === 0;

/**
 * Layer three, ad-hoc: an absolute interval carved out of whatever the layers
 * above produced. Held as Instants because a Block is something that happens,
 * not a recurring rule.
 */
/**
 * The part of a Block that availability actually needs. The reason a Resource
 * is unavailable is the owner's business, and never reaches a customer — the
 * same separation OccupiedSpan makes for Appointments.
 */
export type BlockedSpan = {
  readonly startAt: Instant;
  readonly endAt: Instant;
};

export type Block = BlockedSpan & {
  readonly id: BlockId;
  readonly resourceId: ResourceId;
  readonly businessId: BusinessId;
  readonly reason: string;
};
