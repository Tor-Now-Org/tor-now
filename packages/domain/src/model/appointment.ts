import type { Instant } from "../time/instant.ts";
import type {
  AppointmentId,
  BusinessId,
  ResourceId,
  ServiceId,
  UserId,
} from "./ids.ts";
import type { Money } from "./money.ts";

/**
 * An Appointment exists only in a confirmed state or as a record of one that
 * ended (CONTEXT.md: "Appointment"). There is no provisional or held status —
 * ADR 0003 creates directly as CONFIRMED and relies on the exclusion
 * constraint rather than on holding a slot.
 */
export const APPOINTMENT_STATUSES = [
  "CONFIRMED",
  "CANCELLED",
  "NO_SHOW",
  "COMPLETED",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Who ended an Appointment, recorded because the two are not equivalent. */
export const CANCELLED_BY = ["CUSTOMER", "BUSINESS"] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

export type Appointment = {
  readonly id: AppointmentId;
  readonly businessId: BusinessId;
  readonly resourceId: ResourceId;
  readonly serviceId: ServiceId;
  readonly customerId: UserId;
  readonly startAt: Instant;
  /** The end of the service itself, without the Buffer. */
  readonly endAt: Instant;
  /**
   * The end of the time the Resource is actually consumed for, including the
   * Buffer. ADR 0003 stores this as the range the exclusion constraint checks,
   * which is why changing a Service's Buffer never alters an existing booking.
   */
  readonly occupiedUntil: Instant;
  readonly status: AppointmentStatus;
  /** Snapshots taken at booking time; the Service may change afterwards. */
  readonly serviceName: string;
  readonly price: Money;
  readonly durationMinutes: number;
  readonly bufferMinutes: number;
  readonly customerNote: string | null;
  readonly cancelledAt: Instant | null;
  readonly cancelledBy: CancelledBy | null;
  /** A customer cancellation made inside the Cancellation Window. */
  readonly lateCancellation: boolean;
  readonly createdAt: Instant;
};

export const isActive = (appointment: Pick<Appointment, "status">): boolean =>
  appointment.status === "CONFIRMED";

/** The interval an active Appointment denies to anyone else. */
export const occupiedInterval = (
  appointment: Pick<Appointment, "startAt" | "occupiedUntil">,
) => ({ start: appointment.startAt, end: appointment.occupiedUntil });
