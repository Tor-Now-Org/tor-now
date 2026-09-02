import type { Appointment } from "../model/appointment.ts";
import type { Instant } from "../time/instant.ts";

/**
 * What became of an appointment.
 *
 * Two of these are recorded — a cancellation and a no show are decisions
 * somebody took — and the other two are the clock's. An appointment that was
 * confirmed and whose time has passed simply happened; nothing had to mark it,
 * and a job that flipped a status at the appointed hour would only introduce a
 * window in which the database disagreed with the wall.
 *
 * That is why `COMPLETED` exists in the schema and nothing ever writes it. It
 * is left in place for a later feature that records something *about* the
 * visit — a note, a payment — which would be a decision and would deserve a
 * status. Being finished is not.
 */
export type AppointmentOutcome =
  | "UPCOMING"
  | "FINISHED"
  | "NO_SHOW"
  | "CANCELLED";

export const outcomeOf = (
  appointment: Pick<Appointment, "status" | "endAt">,
  now: Instant,
): AppointmentOutcome => {
  if (appointment.status === "CANCELLED") return "CANCELLED";
  if (appointment.status === "NO_SHOW") return "NO_SHOW";
  // The end rather than the start: between the two the customer is in the
  // chair, and calling that finished would be wrong in front of both of them.
  return now >= appointment.endAt ? "FINISHED" : "UPCOMING";
};

/**
 * Whether the appointment is already under way or over.
 *
 * The boundary for moving one is the start, not the end: an appointment that
 * has begun cannot be given a different time, because the time it was given
 * has already been spent. Being *finished* is measured from the end instead —
 * the two questions have different answers in the half hour between.
 */
export const hasStarted = (
  appointment: Pick<Appointment, "startAt">,
  now: Instant,
): boolean => now >= appointment.startAt;
