import type { UserId } from "@tor-now/domain";
import type { AuditSink } from "../ports/audit.ts";

/** Who is acting, and where their audit rows go: what every audited repository is wrapped with. */
export type Context = { readonly sink: AuditSink; readonly actorId: UserId | null };

/** One audit row, before and after, in the transaction the change is made in (ADR 0006). */
export const record = async (
  { sink, actorId }: Context,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> => {
  await sink.append({ actorId, action, entityType, entityId, before, after });
};
