import { DomainError, notFound } from "@tor-now/domain";
import type { AppointmentRepository } from "../../ports/repositories.ts";
import { errorCodeOf, PG_ERRORS, type Transaction } from "./client.ts";
import { toAppointment, type Row } from "./mappers.ts";

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

  async listForCustomerAtBusiness(customerId, businessId) {
    const rows = await tx<Row[]>`
      select * from appointment
      where customer_id = ${customerId} and business_id = ${businessId}
      order by start_at desc`;
    return rows.map(toAppointment);
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
