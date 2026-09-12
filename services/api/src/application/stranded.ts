import type { Appointment } from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";

/**
 * The people a change to the calendar would leave holding an appointment.
 *
 * Two things strand somebody, and they strand them for different reasons: the
 * shop closing takes the hours away from a day, while a blockage takes a
 * stretch of one calendar. What they share is what has to happen next — the
 * owner is shown who, by name, before anything is written, and each of them is
 * told if the answer is to call them off.
 *
 * That shared part lives here so the two paths cannot drift into warning about
 * different things, or into one of them quietly warning about nothing.
 */

/** An appointment at risk, said the way a screen has to say it. */
export type StrandedAppointment = {
  readonly id: Appointment["id"];
  readonly startAt: Appointment["startAt"];
  readonly resourceName: string;
  readonly serviceName: string;
  readonly customerName: string;
  readonly customerPhone: string;
};

/** What is still standing, and still to come: the only thing worth warning about. */
export const stillToCome = (appointment: Appointment, now: number): boolean =>
  appointment.status === "CONFIRMED" && appointment.startAt > now;

/**
 * The customers behind them.
 *
 * "12 appointments" is not a decision anybody can make; "12 appointments, one
 * of them your Tuesday regular" is.
 */
export const namedFor = async (
  repositories: Repositories,
  appointments: readonly Appointment[],
): Promise<StrandedAppointment[]> =>
  Promise.all(
    appointments.map(async (appointment) => {
      const customer = await repositories.users.findById(appointment.customerId);
      return {
        id: appointment.id,
        startAt: appointment.startAt,
        resourceName: appointment.resourceName,
        serviceName: appointment.serviceName,
        customerName:
          customer === null
            ? ""
            : [customer.givenName, customer.familyName]
                .filter((part) => part !== null && part !== "")
                .join(" "),
        customerPhone: customer?.phone ?? "",
      };
    }),
  );

/** What a screen is shown before it is asked to decide. */
export type Impact = {
  readonly days: number;
  readonly calendars: number;
  readonly appointments: readonly StrandedAppointment[];
};

/** The caller's answer for the people already booked. There is no default. */
export type Upcoming = "KEEP" | "CANCEL";
