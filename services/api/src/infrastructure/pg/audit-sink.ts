import { asId, instant } from "@tor-now/domain";
import type { AuditLogEntry, AuditReader, AuditSink } from "../../ports/audit.ts";
import type { Transaction } from "./client.ts";
import type { Row } from "./mappers.ts";

/**
 * ADR 0006. The insert runs on the same transaction as the mutation it
 * describes, so the two commit together or neither does.
 */
export const auditSink = (tx: Transaction): AuditSink => ({
  async append(entry) {
    // Through app.append_audit rather than the table: the mutation's own role
    // writes this row, and no ordinary role may reach audit_log directly — a
    // trail a caller can write to is a trail a caller can forge.
    await tx`
      select app.append_audit(
        ${entry.actorId},
        ${entry.action},
        ${entry.entityType},
        ${entry.entityId},
        ${entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before)}::jsonb,
        ${entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after)}::jsonb
      )`;
  },
});

export const auditReader = (tx: Transaction): AuditReader => ({
  async recent(limit, offset): Promise<readonly AuditLogEntry[]> {
    const rows = await tx<Row[]>`
      select * from audit_log order by occurred_at desc, id desc
      limit ${limit} offset ${offset}`;
    return rows.map((row) => ({
      id: String(row["id"]),
      actorId: row["actor_id"] === null ? null : asId(String(row["actor_id"])),
      action: String(row["action"]),
      entityType: String(row["entity_type"]),
      entityId: row["entity_id"] === null ? null : String(row["entity_id"]),
      before: row["before"] ?? null,
      after: row["after"] ?? null,
      occurredAt: instant(new Date(row["occurred_at"] as string).getTime()),
    }));
  },
});
