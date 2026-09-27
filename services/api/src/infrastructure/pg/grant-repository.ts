import { asId, displayName, notFound, parseFeature } from "@tor-now/domain";
import type { GrantEntry, GrantRepository } from "../../ports/repositories.ts";
import type { Transaction } from "./client.ts";
import { text, toInstant, toLocalDate, type Row } from "./mappers.ts";

/**
 * Grants (ADR 0021), over the administrator's service connection. Each comes
 * back with the name of whoever gave it, as the Business sheet shows it.
 */
const toGrantEntry = (row: Row): GrantEntry => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  feature: parseFeature(text(row["feature"])),
  reason: text(row["reason"]),
  endsOn: toLocalDate(row["ends_on"]),
  grantedBy: asId(text(row["granted_by"])),
  createdAt: toInstant(row["created_at"]),
  grantedByName:
    row["given_name"] === null || row["given_name"] === undefined
      ? null
      : displayName({
          givenName: text(row["given_name"]),
          familyName: row["family_name"] === null ? null : text(row["family_name"]),
        }),
});

const withGiver = (tx: Transaction) => tx`
  select g.*, u.given_name, u.family_name
  from feature_grant g
  left join app_user u on u.id = g.granted_by`;

export const grantRepository = (tx: Transaction): GrantRepository => ({
  async create(grant) {
    const rows = await tx<Row[]>`
      insert into feature_grant (business_id, feature, reason, ends_on, granted_by)
      values (${grant.businessId}, ${grant.feature}, ${grant.reason}, ${grant.endsOn}, ${grant.grantedBy})
      returning id`;
    const id = rows[0]?.["id"];
    const created = id === undefined ? null : await this.findById(asId(text(id)));
    if (created === null) throw notFound("Grant");
    return created;
  },

  async findById(id) {
    const rows = await tx<Row[]>`${withGiver(tx)} where g.id = ${id}`;
    const row = rows[0];
    return row === undefined ? null : toGrantEntry(row);
  },

  async listForBusiness(businessId) {
    const rows = await tx<Row[]>`
      ${withGiver(tx)} where g.business_id = ${businessId} order by g.ends_on desc, g.created_at desc`;
    return rows.map(toGrantEntry);
  },

  async listRunning(onOrAfter) {
    const rows = await tx<Row[]>`${withGiver(tx)} where g.ends_on >= ${onOrAfter}::date`;
    return rows.map(toGrantEntry);
  },

  async update(id, changes) {
    const rows = await tx<Row[]>`
      update feature_grant set ends_on = ${changes.endsOn}, reason = ${changes.reason}
      where id = ${id} returning id`;
    if (rows[0] === undefined) throw notFound("Grant", id);
    const updated = await this.findById(id);
    if (updated === null) throw notFound("Grant", id);
    return updated;
  },
});
