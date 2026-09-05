import { instant, notFound, type DateOverride } from "@tor-now/domain";
import type {
  BlockRepository,
  DateOverrideRepository,
  ResourceRepository,
  ServiceRepository,
  WorkingHoursRepository,
} from "../../ports/repositories.ts";
import type { Transaction } from "./client.ts";
import {
  toBlock,
  toDateOverride,
  toResource,
  toService,
  toWorkingHours,
  type Row,
  toLocalDate,
} from "./mappers.ts";

const one = <T>(rows: readonly Row[], map: (row: Row) => T, entity: string): T => {
  const row = rows[0];
  if (row === undefined) throw notFound(entity);
  return map(row);
};

export const resourceRepository = (tx: Transaction): ResourceRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`select * from resource where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toResource(row);
  },

  async listForBusiness(businessId) {
    const rows = await tx<Row[]>`
      select * from resource where business_id = ${businessId} order by created_at`;
    return rows.map(toResource);
  },

  async create({ businessId, name }) {
    const rows = await tx<Row[]>`
      insert into resource (business_id, name) values (${businessId}, ${name})
      returning *`;
    return one(rows, toResource, "Resource");
  },

  async update(id, changes) {
    const rows = await tx<Row[]>`
      update resource set
        name = coalesce(${changes.name ?? null}, name),
        active = coalesce(${changes.active ?? null}, active)
      where id = ${id} returning *`;
    return one(rows, toResource, "Resource");
  },

  /**
   * A Resource that has ever been booked is withdrawn rather than removed, for
   * a harder reason than the Service equivalent: appointment.resource_id
   * cascades, so deleting the row takes every appointment ever made against it
   * — the money, the no-shows, the history the Business is judged on — and says
   * nothing while doing it. Withdrawing stops it being offered, which is what
   * an owner removing a calendar actually means.
   */
  async delete(id) {
    const booked = await tx<Row[]>`
      select 1 from appointment where resource_id = ${id} limit 1`;
    if (booked.length > 0) {
      await tx`update resource set active = false where id = ${id}`;
      return;
    }
    await tx`delete from resource where id = ${id}`;
  },
});

export const serviceRepository = (tx: Transaction): ServiceRepository => ({
  async findById(id) {
    const rows = await tx<Row[]>`select * from service where id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toService(row);
  },

  async listForBusiness(businessId, includeInactive) {
    const rows = await tx<Row[]>`
      select * from service
      where business_id = ${businessId}
        and ${includeInactive ? tx`true` : tx`active`}
      order by created_at`;
    return rows.map(toService);
  },

  async create(service) {
    const rows = await tx<Row[]>`
      insert into service (business_id, name, duration_minutes, price_minor, buffer_minutes)
      values (${service.businessId}, ${service.name}, ${service.durationMinutes},
              ${service.price}, ${service.bufferMinutes})
      returning *`;
    return one(rows, toService, "Service");
  },

  async update(id, changes) {
    const rows = await tx<Row[]>`
      update service set
        name = coalesce(${changes.name ?? null}, name),
        duration_minutes = coalesce(${changes.durationMinutes ?? null}, duration_minutes),
        price_minor = coalesce(${changes.price ?? null}, price_minor),
        buffer_minutes = ${changes.bufferMinutes === undefined ? tx`buffer_minutes` : changes.bufferMinutes},
        active = coalesce(${changes.active ?? null}, active)
      where id = ${id} returning *`;
    return one(rows, toService, "Service");
  },

  /**
   * A Service that has ever been booked is withdrawn rather than removed: an
   * Appointment references it, and its history is the Business's record of what
   * actually happened.
   */
  async delete(id) {
    const booked = await tx<Row[]>`
      select 1 from appointment where service_id = ${id} limit 1`;
    if (booked.length > 0) {
      await tx`update service set active = false where id = ${id}`;
      return;
    }
    await tx`delete from service where id = ${id}`;
  },
});

export const workingHoursRepository = (
  tx: Transaction,
): WorkingHoursRepository => ({
  async listForResource(resourceId) {
    const rows = await tx<Row[]>`
      select * from working_hours where resource_id = ${resourceId}
      order by day_of_week, start_local`;
    return rows.map(toWorkingHours);
  },

  async create(hours) {
    const rows = await tx<Row[]>`
      insert into working_hours (resource_id, business_id, day_of_week, start_local, end_local)
      values (${hours.resourceId}, ${hours.businessId}, ${hours.dayOfWeek},
              ${hours.startMinutes}, ${hours.endMinutes})
      returning *`;
    return one(rows, toWorkingHours, "WorkingHours");
  },

  async update(id, changes) {
    const rows = await tx<Row[]>`
      update working_hours
      set start_local = ${changes.startMinutes}, end_local = ${changes.endMinutes}
      where id = ${id} returning *`;
    return one(rows, toWorkingHours, "WorkingHours");
  },

  async delete(id) {
    await tx`delete from working_hours where id = ${id}`;
  },

  async replaceForResource(resourceId, businessId, ranges) {
    await tx`delete from working_hours where resource_id = ${resourceId}`;
    if (ranges.length === 0) return [];
    // One statement for the week. The column list comes from the rows, so the
    // shape is stated once, here.
    const rows = ranges.map((range) => ({
      resource_id: resourceId,
      business_id: businessId,
      day_of_week: range.dayOfWeek,
      start_local: range.startMinutes,
      end_local: range.endMinutes,
    }));
    const written = await tx<Row[]>`
      insert into working_hours ${tx(rows)} returning *`;
    return written.map(toWorkingHours);
  },
});

export const dateOverrideRepository = (
  tx: Transaction,
): DateOverrideRepository => {
  const loadRanges = async (overrideIds: readonly string[]): Promise<Map<string, Row[]>> => {
    if (overrideIds.length === 0) return new Map();
    const rows = await tx<Row[]>`
      select * from date_override_range
      where date_override_id in ${tx(overrideIds)}
      order by start_local`;
    return rows.reduce((grouped, row) => {
      const key = String(row["date_override_id"]);
      const existing = grouped.get(key);
      if (existing === undefined) grouped.set(key, [row]);
      else existing.push(row);
      return grouped;
    }, new Map<string, Row[]>());
  };

  const hydrate = async (rows: readonly Row[]): Promise<DateOverride[]> => {
    const ranges = await loadRanges(rows.map((row) => String(row["id"])));
    return rows.map((row) =>
      toDateOverride(row, ranges.get(String(row["id"])) ?? []),
    );
  };

  return {
    async listForResource(resourceId, from, to) {
      const rows = await tx<Row[]>`
        select * from date_override
        where resource_id = ${resourceId} and on_date between ${from} and ${to}
        order by on_date`;
      return hydrate(rows);
    },

    async findByDate(resourceId, date) {
      const rows = await tx<Row[]>`
        select * from date_override
        where resource_id = ${resourceId} and on_date = ${date}`;
      const hydrated = await hydrate(rows);
      return hydrated[0] ?? null;
    },

    /**
     * ADR 0002 makes an Override a replacement for the whole date, so writing
     * one replaces its ranges wholesale rather than editing them individually.
     * An override with no ranges is a day off, which is why an empty list is a
     * meaningful write rather than a no-op.
     */
    async put(override) {
      const rows = await tx<Row[]>`
        insert into date_override (resource_id, business_id, on_date, note)
        values (${override.resourceId}, ${override.businessId}, ${override.date}, ${override.note})
        on conflict (resource_id, on_date) do update set note = excluded.note
        returning *`;
      const saved = rows[0];
      if (saved === undefined) throw notFound("DateOverride");
      const id = String(saved["id"]);

      await tx`delete from date_override_range where date_override_id = ${id}`;
      const rangeRows = await Promise.all(
        override.ranges.map(
          (range) => tx<Row[]>`
            insert into date_override_range
              (date_override_id, business_id, start_local, end_local)
            values (${id}, ${override.businessId}, ${range.startMinutes}, ${range.endMinutes})
            returning *`,
        ),
      );
      return toDateOverride(saved, rangeRows.flat());
    },

    async delete(id) {
      await tx`delete from date_override where id = ${id}`;
    },
  };
};

export const blockRepository = (tx: Transaction): BlockRepository => ({
  async blockedBetween(resourceId, from, to) {
    const rows = await tx<Row[]>`
      select * from app.blocked_spans(${resourceId}, ${new Date(from)}, ${new Date(to)})`;
    return rows.map((row) => ({
      startAt: instant(new Date(row["start_at"] as string).getTime()),
      endAt: instant(new Date(row["end_at"] as string).getTime()),
    }));
  },

  async countsByLocalDay(resourceId, from, to, timeZone) {
    const rows = await tx<Row[]>`
      select (start_at at time zone ${timeZone})::date as on_date,
             count(*)::int as count
      from block
      where resource_id = ${resourceId}
        and start_at >= ${new Date(from)}
        and start_at < ${new Date(to)}
      group by 1
      order by 1`;
    return rows.map((row) => ({
      date: toLocalDate(row["on_date"]),
      count: Number(row["count"]),
    }));
  },

  async listForResourceBetween(resourceId, from, to) {
    const rows = await tx<Row[]>`
      select * from block
      where resource_id = ${resourceId}
        and start_at < ${new Date(to)} and end_at > ${new Date(from)}
      order by start_at`;
    return rows.map(toBlock);
  },

  async create(block) {
    const rows = await tx<Row[]>`
      insert into block (resource_id, business_id, start_at, end_at, reason)
      values (${block.resourceId}, ${block.businessId}, ${new Date(block.startAt)},
              ${new Date(block.endAt)}, ${block.reason})
      returning *`;
    return one(rows, toBlock, "Block");
  },

  async delete(id) {
    await tx`delete from block where id = ${id}`;
  },
});
