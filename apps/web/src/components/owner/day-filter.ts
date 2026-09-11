import type { CalendarAppointmentDto } from "@/lib/api/types.ts";

/**
 * What the day screen is filtered by, and what that leaves.
 *
 * Two mechanisms produce one state: a search names an individual — a customer,
 * by name or by phone — and a sheet chooses kinds, calendars, services and
 * status. They are different questions, so they get different controls; they
 * end up as the same set of chips, and everything active narrows the same
 * result together.
 */

export type Customer = { readonly name: string; readonly phone: string };

export type Facets = {
  readonly customer: Customer | null;
  readonly calendars: readonly string[];
  readonly services: readonly string[];
  readonly statuses: readonly Status[];
};

export type Status = "UPCOMING" | "SPENT" | "CANCELLED";

export const NOTHING: Facets = {
  customer: null,
  calendars: [],
  services: [],
  statuses: [],
};

export const anyFilter = (facets: Facets): boolean =>
  facets.customer !== null ||
  facets.calendars.length > 0 ||
  facets.services.length > 0 ||
  facets.statuses.length > 0;

/** How many, for the count on the button — a filter you forgot is a bug report. */
export const countOfFilters = (facets: Facets): number =>
  (facets.customer === null ? 0 : 1) +
  facets.calendars.length +
  facets.services.length +
  facets.statuses.length;

/** Digits only, so "050-555-6677", "0505556677" and "5556677" all find her. */
const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * The people behind a set of appointments, each once.
 *
 * Searching "יעל" where two customers are called יעל should offer two rows, not
 * mix their appointments into one list — which is the whole reason the search
 * names a person instead of filtering on a string.
 */
export const customersIn = (
  appointments: readonly CalendarAppointmentDto[],
): Customer[] => {
  const people = new Map<string, Customer>();
  appointments.forEach((appointment) => {
    const phone = appointment.customerPhone;
    if (phone === "") return;
    people.set(phone, { name: appointment.customerName, phone });
  });
  return [...people.values()].sort((left, right) => left.name.localeCompare(right.name));
};

export const matchesQuery = (customer: Customer, query: string): boolean => {
  const trimmed = query.trim();
  if (trimmed === "") return false;
  if (customer.name.includes(trimmed)) return true;
  const digits = digitsOf(trimmed);
  return digits !== "" && digitsOf(customer.phone).includes(digits);
};

export const statusOf = (
  appointment: Pick<CalendarAppointmentDto, "status" | "endAt">,
  now: number,
): Status => {
  if (appointment.status === "CANCELLED") return "CANCELLED";
  return Date.parse(appointment.endAt) <= now ? "SPENT" : "UPCOMING";
};

/**
 * Everything active, applied together.
 *
 * "And", never "or": a customer chip and a service chip together mean her
 * colour appointments, not everything of hers plus every colour.
 */
export const keptBy = (
  appointments: readonly CalendarAppointmentDto[],
  facets: Facets,
  now: number,
): CalendarAppointmentDto[] =>
  appointments.filter((appointment) => {
    if (facets.customer !== null && appointment.customerPhone !== facets.customer.phone) {
      return false;
    }
    if (
      facets.calendars.length > 0 &&
      !facets.calendars.includes(appointment.resourceId)
    ) {
      return false;
    }
    if (facets.services.length > 0 && !facets.services.includes(appointment.serviceName)) {
      return false;
    }
    if (
      facets.statuses.length > 0 &&
      !facets.statuses.includes(statusOf(appointment, now))
    ) {
      return false;
    }
    return true;
  });

export type Reach = "DAY" | "WEEK" | "ALL";

/** How far a filtered view looks — the day it was opened on, or wider. */
export const withinReach = (
  appointments: readonly CalendarAppointmentDto[],
  reach: Reach,
  date: string,
): CalendarAppointmentDto[] => {
  if (reach === "ALL") return [...appointments];
  return appointments.filter((appointment) => {
    const on = appointment.startAt.slice(0, 10);
    if (reach === "DAY") return on === date;
    // A week from the day being read, which is what "this week" means to
    // somebody looking at that day rather than at a calendar month.
    const days = (Date.parse(`${on}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
    return days >= 0 && days < 7;
  });
};
