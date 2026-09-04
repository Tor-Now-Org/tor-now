import { asId, displayName, DomainError, instant, notFound } from "@tor-now/domain";
import type { AppointmentRepository } from "../../ports/repositories.ts";
import { errorCodeOf, PG_ERRORS, type Transaction } from "./client.ts";
import {
  nullableText,
  text,
  toAppointment,
  toLocalDate,
  type Row,
} from "./mappers.ts";

/**
 * The two halves of a name, as the mapper reads every other row's. Kept beside
 * the query that joins them so the join and the reading cannot drift again.
 */
const toNameHalves = (row: Row) => ({
  givenName: text(row["given_name"]),
  familyName: nullableText(row["family_name"]),
});

const one = (rows: readonly Row[]) => {
  const row = rows[0];
  if (row === undefined) throw notFound("Appointment");
  return toAppointment(row);
};

const asDate = (value: number) => new Date(value);

export const appointmentRepository = (
  tx: Transaction,
): AppointmentRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`select * from appointment where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toAppointment(row);
  },

  async occupiedBetween(resourceId, from, to) {
    const rows = await tx<Row[]>`
      select * from app.occupied_spans(${resourceId}, ${asDate(from)}, ${asDate(to)})`;
    return rows.map((row) => ({
      appointmentId: asId(String(row["appointment_id"])),
      startAt: instant(new Date(row["start_at"] as string).getTime()),
      occupiedUntil: instant(new Date(row["occupied_until"] as string).getTime()),
    }));
  },

  /**
   * Grouped by the Business's own calendar day. Postgres does the conversion,
   * because the boundary between one day and the next is a property of the zone
   * and doing it here would mean fetching every row to find out which day it
   * fell on.
   */
  async countsByLocalDay(resourceId, from, to, timeZone) {
    const rows = await tx<Row[]>`
      select (start_at at time zone ${timeZone})::date as on_date,
             count(*)::int as count
      from appointment
      where resource_id = ${resourceId}
        and start_at >= ${new Date(from)}
        and start_at < ${new Date(to)}
        and status <> 'CANCELLED'
      group by 1
      order by 1`;
    return rows.map((row) => ({
      date: toLocalDate(row["on_date"]),
      count: Number(row["count"]),
    }));
  },

  async searchUpcoming(businessId, query, from, limit) {
    const like = `%${query}%`;
    const rows = await tx<Row[]>`
      select a.*, c.given_name, c.family_name, c.phone as customer_phone
      from appointment a
      join app_user c on c.id = a.customer_id
      where a.business_id = ${businessId}
        and a.status = 'CONFIRMED'
        and a.start_at >= ${asDate(from)}
        and (
          c.given_name ilike ${like}
          or coalesce(c.family_name, '') ilike ${like}
          or c.phone like ${like}
        )
      order by a.start_at
      limit ${limit}`;
    return rows.map((row) => ({
      appointment: toAppointment(row),
      customerName: displayName(toNameHalves(row)),
      customerPhone: text(row["customer_phone"]),
    }));
  },

  async listForResourceBetween(resourceId, from, to) {
    const rows = await tx<Row[]>`
      select * from appointment
      where resource_id = ${resourceId}
        and start_at < ${asDate(to)} and occupied_until > ${asDate(from)}
      order by start_at`;
    return rows.map(toAppointment);
  },

  async listForBusinessBetween(businessId, from, to) {
    const rows = await tx<Row[]>`
      select * from appointment
      where business_id = ${businessId}
        and start_at >= ${asDate(from)} and start_at < ${asDate(to)}
      order by start_at`;
    return rows.map(toAppointment);
  },

  async listForCustomer(customerId, page) {
    const rows = await tx<Row[]>`
      select * from appointment
      where customer_id = ${customerId}
      order by start_at desc
      limit ${page.limit} offset ${page.offset}`;
    return rows.map(toAppointment);
  },

  async listForCustomerWithBusiness(customerId, page) {
    const rows = await tx<Row[]>`
      select a.*, b.name as business_name
      from appointment a
      join business b on b.id = a.business_id
      where a.customer_id = ${customerId}
      order by a.start_at desc
      limit ${page.limit} offset ${page.offset}`;
    return rows.map((row) => ({
      appointment: toAppointment(row),
      businessName: text(row["business_name"]),
    }));
  },

  async listForCustomerAtBusiness(customerId, businessId) {
    const rows = await tx<Row[]>`
      select * from appointment
      where customer_id = ${customerId} and business_id = ${businessId}
      order by start_at desc`;
    return rows.map(toAppointment);
  },

  async hasConfirmedForServiceBetween(customerId, serviceId, from, to) {
    const rows = await tx<{ found: boolean }[]>`
      select exists (
        select 1 from appointment
        where customer_id = ${customerId}
          and service_id = ${serviceId}
          and status = 'CONFIRMED'
          and start_at >= ${asDate(from)} and start_at < ${asDate(to)}
      ) as found`;
    return rows[0]?.found === true;
  },

  async customerIdsFor(businessId) {
    // Every status: a cancelled appointment ends a booking, not a
    // relationship, and the owner still has to be able to find that person.
    const rows = await tx<{ customer_id: string }[]>`
      select distinct customer_id from appointment
      where business_id = ${businessId}`;
    return rows.map((row) => asId(row.customer_id));
  },

  /**
   * One query rather than one per appointment: a reminder names the customer
   * and the business, and the job may be handling a hundred of them.
   *
   * `for update skip locked` means two workers can drain this together without
   * both claiming the same appointment — the same device the outbox uses.
   */
  async dueForReminder(from, to, limit) {
    const rows = await tx<Row[]>`
      select a.*,
             c.given_name, c.family_name, c.phone as customer_phone,
             b.name  as business_name,  b.phone as business_phone,
             b.time_zone as business_time_zone
      from appointment a
      join app_user c on c.id = a.customer_id
      join business  b on b.id = a.business_id
      where a.status = 'CONFIRMED'
        and a.reminder_enqueued_at is null
        and a.start_at >= ${asDate(from)}
        and a.start_at < ${asDate(to)}
      order by a.start_at
      limit ${limit}
      for update of a skip locked`;

    return rows.map((row) => ({
      appointment: toAppointment(row),
      // The two halves are joined the way every other screen joins them, so a
      // reminder names somebody the same as the calendar does.
      customerName: displayName(toNameHalves(row)),
      customerPhone: String(row["customer_phone"]),
      businessName: String(row["business_name"]),
      businessPhone: String(row["business_phone"]),
      businessTimeZone: String(row["business_time_zone"]),
    }));
  },

  async markReminderEnqueued(ids) {
    if (ids.length === 0) return;
    await tx`
      update appointment set reminder_enqueued_at = now()
      where id in ${tx([...ids])}`;
  },

  /**
   * ADR 0003: the application attempts the insert and translates a constraint
   * violation, rather than checking first. A check-then-insert would be wrong
   * at READ COMMITTED — two transactions can both see no conflict, because the
   * row each would conflict with does not exist yet.
   *
   * `SLOT_TAKEN` is a recoverable error: the interface re-renders availability
   * in place rather than losing the customer's other choices.
   */
  async create(draft) {
    try {
      const rows = await tx<Row[]>`
        insert into appointment (
          business_id, resource_id, service_id, customer_id,
          start_at, end_at, occupied_until, status,
          service_name, price_minor, duration_minutes, buffer_minutes, customer_note)
        values (
          ${draft.businessId}, ${draft.resourceId}, ${draft.serviceId}, ${draft.customerId},
          ${asDate(draft.startAt)}, ${asDate(draft.endAt)}, ${asDate(draft.occupiedUntil)},
          ${draft.status}, ${draft.serviceName}, ${draft.price},
          ${draft.durationMinutes}, ${draft.bufferMinutes}, ${draft.customerNote})
        returning *`;
      return one(rows);
    } catch (error) {
      if (errorCodeOf(error) === PG_ERRORS.exclusionViolation) {
        throw new DomainError(
          "SLOT_TAKEN",
          "That time was taken while you were confirming it",
        );
      }
      throw error;
    }
  },

  async update(id, changes) {
    try {
      const rows = await tx<Row[]>`
        update appointment set
          status = coalesce(${changes.status ?? null}, status),
          start_at = coalesce(${changes.startAt === undefined ? null : asDate(changes.startAt)}, start_at),
          end_at = coalesce(${changes.endAt === undefined ? null : asDate(changes.endAt)}, end_at),
          occupied_until = coalesce(${changes.occupiedUntil === undefined ? null : asDate(changes.occupiedUntil)}, occupied_until),
          cancelled_at = ${changes.cancelledAt === undefined ? tx`cancelled_at` : changes.cancelledAt === null ? null : asDate(changes.cancelledAt)},
          cancelled_by = ${changes.cancelledBy === undefined ? tx`cancelled_by` : changes.cancelledBy},
          late_cancellation = coalesce(${changes.lateCancellation ?? null}, late_cancellation)
        where id = ${id}
        returning *`;
      return one(rows);
    } catch (error) {
      if (errorCodeOf(error) === PG_ERRORS.exclusionViolation) {
        throw new DomainError(
          "SLOT_TAKEN",
          "That time was taken while you were moving the appointment",
        );
      }
      throw error;
    }
  },
});
