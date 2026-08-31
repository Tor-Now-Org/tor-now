import { AUDIT_RETENTION_DAYS } from "../config.ts";
import type { Sql } from "../infrastructure/pg/client.ts";

/**
 * ADR 0006: the audit table grows monotonically and needs a retention job.
 * Rows are kept for one year.
 *
 * This is the one write that deliberately bypasses the repositories: the
 * append-only trigger refuses DELETE from any normal path, which is the point,
 * so pruning disables it for the length of its own transaction.
 */
export const pruneAuditLog = async (sql: Sql): Promise<number> =>
  sql.begin(async (tx) => {
    // The trigger refuses DELETE from every path, which is the point. Retention
    // is the one sanctioned exception, and it announces itself with a
    // transaction-local setting the trigger checks — so the exception cannot
    // outlive this statement or be set by anything reaching the table over a
    // pooled connection.
    await tx`select set_config('app.audit_retention', 'on', true)`;
    const [row] = await tx`
      with pruned as (
        delete from audit_log
        where occurred_at < now() - make_interval(days => ${AUDIT_RETENTION_DAYS})
        returning 1
      )
      select count(*)::int as removed from pruned`;
    return Number(row?.["removed"] ?? 0);
  }) as Promise<number>;
