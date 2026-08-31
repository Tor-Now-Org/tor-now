import type { Appointment, OccupiedSpan } from "../model/appointment.ts";
import type { Business, Resource, Service } from "../model/business.ts";
import { BUSINESS_DEFAULTS } from "../model/business.ts";
import { asId } from "../model/ids.ts";
import { money } from "../model/money.ts";
import type { Block, DateOverride, WorkingHours } from "../model/schedule.ts";
import { instant, type Instant } from "../time/instant.ts";
import { parseLocalDate, type LocalDate } from "../time/local-date.ts";
import { parseLocalTime } from "../time/local-time.ts";
import { timeZone, zonedToInstant } from "../time/zone.ts";

/**
 * Builders for the scheduling tests. Each takes a partial override so a test
 * states only the field it is about.
 */
export const JERUSALEM = timeZone("Asia/Jerusalem");

export const aBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: asId("business-1"),
  name: "מספרת רן",
  phone: "+972501234567",
  timeZone: JERUSALEM,
  description: null,
  address: null,
  active: true,
  defaultBufferMinutes: BUSINESS_DEFAULTS.defaultBufferMinutes,
  minimumNoticeMinutes: BUSINESS_DEFAULTS.minimumNoticeMinutes,
  bookingHorizonDays: BUSINESS_DEFAULTS.bookingHorizonDays,
  cancellationWindowHours: BUSINESS_DEFAULTS.cancellationWindowHours,
  ...overrides,
});

export const aResource = (overrides: Partial<Resource> = {}): Resource => ({
  id: asId("resource-1"),
  businessId: asId("business-1"),
  name: "רן",
  active: true,
  ...overrides,
});

export const aService = (overrides: Partial<Service> = {}): Service => ({
  id: asId("service-1"),
  businessId: asId("business-1"),
  name: "תספורת",
  durationMinutes: 30,
  price: money(8000),
  bufferMinutes: null,
  active: true,
  ...overrides,
});

export const workingHours = (
  dayOfWeek: number,
  start: string,
  end: string,
  overrides: Partial<WorkingHours> = {},
): WorkingHours =>
  ({
    id: asId(`wh-${dayOfWeek}-${start}-${end}`),
    resourceId: asId("resource-1"),
    businessId: asId("business-1"),
    dayOfWeek,
    start: parseLocalTime(start),
    end: parseLocalTime(end),
    ...overrides,
  }) as WorkingHours;

export const dateOverride = (
  date: string,
  ranges: readonly (readonly [string, string])[],
  overrides: Partial<DateOverride> = {},
): DateOverride =>
  ({
    id: asId(`override-${date}`),
    resourceId: asId("resource-1"),
    businessId: asId("business-1"),
    date: parseLocalDate(date),
    note: null,
    ranges: ranges.map(([start, end]) => ({
      start: parseLocalTime(start),
      end: parseLocalTime(end),
    })),
    ...overrides,
  }) as DateOverride;

/** An instant expressed in the fixture business's own wall clock. */
export const at = (date: string, time: string): Instant =>
  zonedToInstant(parseLocalDate(date), parseLocalTime(time), JERUSALEM);

export const aBlock = (
  date: string,
  start: string,
  end: string,
  overrides: Partial<Block> = {},
): Block =>
  ({
    id: asId(`block-${date}-${start}`),
    resourceId: asId("resource-1"),
    businessId: asId("business-1"),
    startAt: at(date, start),
    endAt: at(date, end),
    reason: "פגישה אישית",
    ...overrides,
  }) as Block;

export const anAppointment = (
  date: string,
  start: string,
  durationMinutes: number,
  bufferMinutes = 0,
  overrides: Partial<Appointment> = {},
): Appointment => {
  const startAt = at(date, start);
  const minute = 60_000;
  return {
    id: asId(`appointment-${date}-${start}`),
    businessId: asId("business-1"),
    resourceId: asId("resource-1"),
    serviceId: asId("service-1"),
    customerId: asId("user-1"),
    startAt,
    endAt: instant(startAt + durationMinutes * minute),
    occupiedUntil: instant(
      startAt + (durationMinutes + bufferMinutes) * minute,
    ),
    status: "CONFIRMED",
    serviceName: "תספורת",
    price: money(8000),
    durationMinutes,
    bufferMinutes,
    customerNote: null,
    cancelledAt: null,
    cancelledBy: null,
    lateCancellation: false,
    createdAt: instant(startAt - minute * 60 * 24),
    ...overrides,
  } as Appointment;
};

export const onDate = (date: string): LocalDate => parseLocalDate(date);

/** What availability actually consumes: when a Resource is busy, and nothing else. */
export const anOccupiedSpan = (
  date: string,
  start: string,
  durationMinutes: number,
  bufferMinutes = 0,
  overrides: Partial<OccupiedSpan> = {},
): OccupiedSpan => {
  const startAt = at(date, start);
  return {
    appointmentId: asId(`appointment-${date}-${start}`),
    startAt,
    occupiedUntil: instant(startAt + (durationMinutes + bufferMinutes) * 60_000),
    ...overrides,
  };
};
