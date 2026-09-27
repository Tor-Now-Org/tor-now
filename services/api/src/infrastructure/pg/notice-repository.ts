import type { NoticeRepository } from "../../ports/repositories.ts";
import type { Transaction } from "./client.ts";
import { toNotice, type Row } from "./mappers.ts";

/**
 * Notices (ADR 0020). An owner reaches this under their own session, where RLS
 * lets them read their Business's Notices, keep the ones telling of their own
 * acts, and touch nothing but when each was read or cleared.
 */
export const noticeRepository = (tx: Transaction): NoticeRepository => ({
  async post(notice) {
    const rows = await tx<Row[]>`
      insert into notice (business_id, kind, facts, dedupe_key)
      values (${notice.businessId}, ${notice.facts.kind},
              ${tx.json(notice.facts)}, ${notice.key})
      on conflict (business_id, dedupe_key) do nothing
      returning *`;
    const row = rows[0];
    return row === undefined ? null : toNotice(row);
  },

  async listForBusiness(businessId, limit) {
    const rows = await tx<Row[]>`
      select * from notice
      where business_id = ${businessId}
      order by created_at desc, id
      limit ${limit}`;
    return rows.map(toNotice);
  },

  async clear(businessId, kinds, at) {
    if (kinds.length === 0) return;
    await tx`
      update notice set cleared_at = ${new Date(at)}
      where business_id = ${businessId}
        and kind = any(${[...kinds]}::text[])
        and cleared_at is null`;
  },

  async acknowledge(businessId, id, at) {
    const rows = await tx<Row[]>`
      update notice
      set cleared_at = coalesce(cleared_at, ${new Date(at)}),
          read_at = coalesce(read_at, ${new Date(at)})
      where business_id = ${businessId} and id = ${id}
      returning *`;
    const row = rows[0];
    return row === undefined ? null : toNotice(row);
  },

  async markAllRead(businessId, at) {
    await tx`
      update notice set read_at = ${new Date(at)}
      where business_id = ${businessId} and read_at is null`;
  },
});
