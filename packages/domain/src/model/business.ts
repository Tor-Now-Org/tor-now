import type { Instant } from "../time/instant.ts";
import type { BusinessCategory } from "./business-category.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { LocalTime } from "../time/local-time.ts";
import type { TimeZone } from "../time/zone.ts";
import type { BusinessId, BusinessPhotoId, ResourceId, ServiceId } from "./ids.ts";
import type { Money } from "./money.ts";
import { MINUTES_PER_DAY } from "../shared/constants.ts";

/**
 * Platform-wide defaults for a newly registered Business. ADR 0012 fixes the
 * booking window at sixty minutes' notice and sixty days ahead.
 */
export const BUSINESS_DEFAULTS = Object.freeze({
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 60,
  defaultBufferMinutes: 0,
  cancellationWindowHours: 24,
  timeZone: "Asia/Jerusalem",
});

/**
 * How long a Service may be: five minutes at the least, so a day is not cut
 * into slivers nobody can book, and a whole day at the most. A new one starts
 * at half an hour.
 */
export const SERVICE_MINUTES = Object.freeze({ min: 5, max: MINUTES_PER_DAY, initial: 30 });

/** A tenant of the platform — the service provider a customer books with. */
export type Business = {
  readonly id: BusinessId;
  readonly name: string;
  readonly phone: string;
  readonly timeZone: TimeZone;
  readonly description: string | null;
  readonly address: string | null;
  /** The pin the owner dropped on the map. Null until they place one. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  /**
   * ADR 0024: up to three, the first the main one — what a card and a map pin
   * call the Business. Empty only for one registered before Categories existed.
   */
  readonly categories: readonly BusinessCategory[];
  /** Instagram handle, bare: no @ and no URL. Null when the business has none. */
  readonly instagram: string | null;
  /**
   * The number this business answers WhatsApp on, E.164. Separate from `phone`
   * on purpose: many publish one number for calls and another for messages.
   */
  readonly whatsapp: string | null;
  /** True on registration (ADR 0011); an administrator or Billing clears it. */
  readonly active: boolean;
  readonly defaultBufferMinutes: number;
  readonly minimumNoticeMinutes: number;
  readonly bookingHorizonDays: number;
  readonly cancellationWindowHours: number;
  readonly createdAt: Instant;
};

/**
 * How many pictures a Business may show, and which slot each one occupies.
 *
 * The cover is slot zero rather than a boolean, so "which is the cover" and
 * "how many are there" are the same fact: the database gives each Business one
 * row per slot, and the range is the limit. Nothing counts rows to find out.
 */
export const PHOTO_SLOTS = Object.freeze({
  cover: 0,
  firstExtra: 1,
  lastExtra: 3,
});

export type PhotoSlot = 0 | 1 | 2 | 3;

/** Every slot, in the order they are shown. The cover leads. */
export const PHOTO_SLOTS_IN_ORDER: readonly PhotoSlot[] = Object.freeze([0, 1, 2, 3]);

export const MAXIMUM_PHOTOS = PHOTO_SLOTS_IN_ORDER.length;

/**
 * A picture of a Business. The bytes are elsewhere, and where exactly is not
 * the domain's business: this is the record of one of them, holding the key
 * that finds it. The address a browser fetches it from is added on the way out,
 * because it depends on which store is behind the deployment.
 */
export type BusinessPhoto = {
  readonly id: BusinessPhotoId;
  readonly businessId: BusinessId;
  readonly slot: PhotoSlot;
  readonly storagePath: string;
  readonly contentType: string;
  readonly byteSize: number;
};

/** A single bookable calendar belonging to a Business. */
export type Resource = {
  readonly id: ResourceId;
  readonly businessId: BusinessId;
  readonly name: string;
  /** False once its owner hid or removed it. */
  readonly active: boolean;
  /**
   * Set while the Business holds more Resources than its Resource Allowance
   * (CONTEXT.md, Paused Resource). It keeps its hours and appointments, and
   * comes back as it was once the Allowance covers it again.
   */
  readonly pausedAt: Instant | null;
  /**
   * The day it will pause, when its owner has scheduled a move to a Plan with
   * room for fewer calendars and chose not to keep this one.
   */
  readonly pauseOn: LocalDate | null;
};

/**
 * Whether customers can book it: its owner offers it, and it is not paused.
 * The question every booking path asks — the owner's own views ask only
 * `active`, so a paused calendar stays in front of them.
 */
export const isOnOffer = (resource: Pick<Resource, "active" | "pausedAt">): boolean =>
  resource.active && resource.pausedAt === null;

/** Something a Business offers at a defined duration and price. */
export type Service = {
  readonly id: ServiceId;
  readonly businessId: BusinessId;
  readonly name: string;
  readonly durationMinutes: number;
  readonly price: Money;
  /** Null falls back to the Business default (CONTEXT.md: "Buffer"). */
  readonly bufferMinutes: number | null;
  readonly active: boolean;
};

/** The Buffer that actually applies to a Service, resolving the fallback. */
export const effectiveBufferMinutes = (
  service: Pick<Service, "bufferMinutes">,
  business: Pick<Business, "defaultBufferMinutes">,
): number => service.bufferMinutes ?? business.defaultBufferMinutes;

/** The time a Service occupies on a Resource: its duration plus its Buffer. */
export const occupiedMinutes = (
  service: Pick<Service, "durationMinutes" | "bufferMinutes">,
  business: Pick<Business, "defaultBufferMinutes">,
): number =>
  service.durationMinutes + effectiveBufferMinutes(service, business);

export type LocalTimeRange = {
  readonly start: LocalTime;
  readonly end: LocalTime;
};
