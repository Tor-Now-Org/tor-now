import type { LocalTime } from "../time/local-time.ts";
import type { TimeZone } from "../time/zone.ts";
import type { BusinessId, BusinessPhotoId, ResourceId, ServiceId } from "./ids.ts";
import type { Money } from "./money.ts";

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

/** A tenant of the platform — the service provider a customer books with. */
export type Business = {
  readonly id: BusinessId;
  readonly name: string;
  readonly phone: string;
  readonly timeZone: TimeZone;
  readonly description: string | null;
  readonly address: string | null;
  /** True on registration (ADR 0011); an administrator or Billing clears it. */
  readonly active: boolean;
  readonly defaultBufferMinutes: number;
  readonly minimumNoticeMinutes: number;
  readonly bookingHorizonDays: number;
  readonly cancellationWindowHours: number;
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
  readonly active: boolean;
};

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
