import {
  asId,
  instant,
  notFound,
  wantedPartsOfDay,
  type PartOfDay,
  type ResourceId,
} from "@tor-now/domain";
import type {
  WaitingEntry,
  WaitingEntryRepository,
  WaitingEntryToTell,
  WaitingRecheckRepository,
} from "../../ports/repositories.ts";
import type { Transaction } from "./client.ts";
import { nullableText, text, toLocalDate, type Row } from "./mappers.ts";

const toInstant = (value: unknown) =>
  value === null || value === undefined ? null : instant(new Date(value as string).getTime());

/**
 * The parts come back as a Postgres text array. They are re-read through the
 * domain rather than cast, so a row that somehow holds something else fails at
 * the boundary instead of becoming a Waiting Entry nothing will ever answer.
 */
const toParts = (value: unknown): readonly PartOfDay[] =>
  wantedPartsOfDay((value as readonly string[]).map(String));

const toEntry = (row: Row, resourceIds: readonly ResourceId[]): WaitingEntry => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  customerId: asId(text(row["customer_id"])),
  serviceId: asId(text(row["service_id"])),
  resourceIds,
  onDate: toLocalDate(row["on_date"]),
  parts: toParts(row["parts"]),
  lastNotifiedAt: toInstant(row["last_notified_at"]),
  closedAt: toInstant(row["closed_at"]),
});

/**
 * The calendars each entry named, for a page of entries at once.
 *
 * One statement rather than one per entry: a busy morning can free several
 * hours at once, and a round trip per waiting customer is exactly what the
 * reminder job was careful to avoid.
 */
const resourcesOf = async (
  tx: Transaction,
  entryIds: readonly string[],
): Promise<Map<string, { id: ResourceId; name: string }[]>> => {
  const byEntry = new Map<string, { id: ResourceId; name: string }[]>();
  if (entryIds.length === 0) return byEntry;

  // The calendar's name comes along in the same statement: the customer's own
  // list names them, and a join costs nothing a second read would not.
  const rows = await tx<Row[]>`
    select wr.entry_id, wr.resource_id, r.name
    from waiting_entry_resource wr
    join resource r on r.id = wr.resource_id
    where wr.entry_id = any(${entryIds}::uuid[])`;
  for (const row of rows) {
    const key = text(row["entry_id"]);
    const held = byEntry.get(key) ?? [];
    held.push({ id: asId(text(row["resource_id"])), name: text(row["name"]) });
    byEntry.set(key, held);
  }
  return byEntry;
};

const withResources = async (
  tx: Transaction,
  rows: readonly Row[],
): Promise<WaitingEntry[]> => {
  const byEntry = await resourcesOf(tx, rows.map((row) => text(row["id"])));
  return rows.map((row) =>
    toEntry(
      row,
      (byEntry.get(text(row["id"])) ?? []).map((resource) => resource.id),
    ),
  );
};

export const waitingEntryRepository = (tx: Transaction): WaitingEntryRepository => ({
  async put({ businessId, customerId, serviceId, resourceIds, onDate, parts }) {
    // The partial unique index covers only open entries, so the conflict
    // target has to name the same predicate.
    const rows = await tx<Row[]>`
      insert into waiting_entry (business_id, customer_id, service_id, on_date, parts)
      values (${businessId}, ${customerId}, ${serviceId}, ${onDate}, ${[...parts]})
      on conflict (business_id, customer_id, service_id, on_date)
        where closed_at is null
        do update set parts = excluded.parts,
                      -- Changing one's mind is a fresh question, so it is
                      -- eligible to be told about the very next opening.
                      last_notified_at = null
      returning *`;
    const row = rows[0];
    if (row === undefined) throw notFound("WaitingEntry");

    const id = text(row["id"]);
    await tx`delete from waiting_entry_resource where entry_id = ${id}`;
    await tx`
      insert into waiting_entry_resource (entry_id, resource_id)
      select ${id}::uuid, unnest(${[...resourceIds]}::uuid[])`;

    return toEntry(row, resourceIds);
  },

  async findById(id) {
    const rows = await tx<Row[]>`select * from waiting_entry where id = ${id}`;
    const found = await withResources(tx, rows);
    return found[0] ?? null;
  },

  async openForCustomer(customerId, from) {
    const rows = await tx<Row[]>`
      select * from waiting_entry
      where customer_id = ${customerId}
        and closed_at is null
        and on_date >= ${from}
      order by on_date`;
    return withResources(tx, rows);
  },

  async openForCustomerNamed(customerId, from, businessId) {
    const rows = await tx<Row[]>`
      select w.*,
             s.name as service_name,
             b.name as business_name, b.time_zone
        from waiting_entry w
        join service s on s.id = w.service_id
        join business b on b.id = w.business_id
       where w.customer_id = ${customerId}
         and w.closed_at is null
         and w.on_date >= ${from}
         and (${businessId}::uuid is null or w.business_id = ${businessId})
       order by w.on_date`;

    // An entry whose Business or Service has gone is dropped by the join, which
    // is what reading them one at a time did by skipping a null.
    const byEntry = await resourcesOf(tx, rows.map((row) => text(row["id"])));
    return rows.map((row) => {
      const named = byEntry.get(text(row["id"])) ?? [];
      const entry = toEntry(
        row,
        named.map((resource) => resource.id),
      );
      return {
        entry,
        businessName: text(row["business_name"]),
        businessTimeZone: text(row["time_zone"]),
        serviceName: text(row["service_name"]),
        // In the entry's own order, and without a calendar that has gone.
        resourceNames: entry.resourceIds.flatMap((id) => {
          const found = named.find((resource) => resource.id === id);
          return found === undefined ? [] : [found.name];
        }),
      };
    });
  },

  async toTell(resourceId, onDate, notifiedBefore) {
    const rows = await tx<Row[]>`
      select w.*,
             u.given_name, u.family_name, u.phone as customer_phone,
             s.name as service_name,
             b.name as business_name, b.phone as business_phone, b.time_zone
        from waiting_entry w
        join waiting_entry_resource wr on wr.entry_id = w.id
        join app_user u on u.id = w.customer_id
        join service s on s.id = w.service_id
        join business b on b.id = w.business_id
       where wr.resource_id = ${resourceId}
         and w.on_date = ${onDate}
         and w.closed_at is null
         and (w.last_notified_at is null or w.last_notified_at < ${notifiedBefore})
         and u.deleted_at is null
       order by w.created_at`;

    const entries = await withResources(tx, rows);
    return rows.map((row, at): WaitingEntryToTell => ({
      entry: entries[at]!,
      customerName: `${text(row["given_name"])} ${nullableText(row["family_name"]) ?? ""}`.trim(),
      customerPhone: text(row["customer_phone"]),
      serviceName: text(row["service_name"]),
      businessName: text(row["business_name"]),
      businessPhone: text(row["business_phone"]),
      businessTimeZone: text(row["time_zone"]),
    }));
  },

  async markNotified(ids, at) {
    if (ids.length === 0) return;
    await tx`
      update waiting_entry set last_notified_at = ${new Date(at).toISOString()}
      where id = any(${[...ids]}::uuid[])`;
  },

  async close(ids, at) {
    if (ids.length === 0) return;
    await tx`
      update waiting_entry set closed_at = ${new Date(at).toISOString()}
      where id = any(${[...ids]}::uuid[]) and closed_at is null`;
  },

  async closeForBooking(customerId, businessId, serviceId, onDate, at) {
    await tx`
      update waiting_entry set closed_at = ${new Date(at).toISOString()}
      where customer_id = ${customerId}
        and business_id = ${businessId}
        and service_id = ${serviceId}
        and on_date = ${onDate}
        and closed_at is null`;
  },
});

export const waitingRecheckRepository = (tx: Transaction): WaitingRecheckRepository => ({
  async mark(resourceId, onDate) {
    // Through the function rather than straight at the table: the marks are
    // readable by nobody, and an upsert that cannot see its own conflict is
    // refused by Row Level Security. See the migration for the whole of it.
    await tx`select app.mark_for_recheck(${resourceId}::uuid, ${onDate}::date)`;
  },

  async markMany(marks) {
    if (marks.length === 0) return;
    // One statement, the function called once per pair: the marks stay
    // unreadable and the upsert keeps seeing its own conflict, exactly as the
    // single mark does. See the migration for why it cannot touch the table.
    await tx`
      select app.mark_for_recheck(m.resource_id, m.on_date)
      from unnest(
        ${marks.map((mark) => mark.resourceId)}::uuid[],
        ${marks.map((mark) => mark.onDate)}::date[]
      ) as m(resource_id, on_date)`;
  },

  async oldest(limit) {
    const rows = await tx<Row[]>`
      select resource_id, on_date from waiting_recheck
      order by created_at
      limit ${limit}`;
    return rows.map((row) => ({
      resourceId: asId<"Resource">(text(row["resource_id"])),
      onDate: toLocalDate(row["on_date"]),
    }));
  },

  async clear(marks) {
    if (marks.length === 0) return;
    // Paired by position rather than as a list of tuples: postgres.js cannot
    // send an anonymous composite, and unnest of two arrays says the same
    // thing in one statement.
    await tx`
      delete from waiting_recheck
      using unnest(
        ${marks.map((mark) => mark.resourceId)}::uuid[],
        ${marks.map((mark) => mark.onDate)}::date[]
      ) as done (resource_id, on_date)
      where waiting_recheck.resource_id = done.resource_id
        and waiting_recheck.on_date = done.on_date`;
  },
});
