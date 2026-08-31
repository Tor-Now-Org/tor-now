import type { UserId } from "@tor-now/domain";
import type { Repositories } from "./repositories.ts";
import type { AuditReader, AuditSink } from "./audit.ts";
import type { Outbox } from "./notifier.ts";

/**
 * Who is acting. ADR 0007 re-establishes this on the connection per
 * transaction, so Row Level Security sees the same caller the application does.
 */
export type Actor =
  | { readonly kind: "ANONYMOUS" }
  | { readonly kind: "USER"; readonly userId: UserId }
  /**
   * ADR 0010. Runs over the service_role connection, which bypasses RLS —
   * there is no database backstop on this path, only application code, which
   * is why every action taken as one is audited without exception.
   */
  | { readonly kind: "ADMINISTRATOR"; readonly userId: UserId }
  /**
   * Scheduled work — draining the outbox, pruning the audit log. It has no
   * human behind it, so the trail records no actor rather than attributing a
   * cron run to whichever administrator happened to be last.
   */
  | { readonly kind: "SYSTEM" };

export const anonymous = (): Actor => ({ kind: "ANONYMOUS" });

export const system = (): Actor => ({ kind: "SYSTEM" });

export const actorUserId = (actor: Actor): UserId | null =>
  actor.kind === "ANONYMOUS" || actor.kind === "SYSTEM" ? null : actor.userId;

/**
 * A transaction, with repositories bound to it. Everything a request writes —
 * the mutation, its audit row (ADR 0006) and any outbox entry (ADR 0005) —
 * commits together or not at all.
 */
export type Session = {
  readonly repositories: Repositories;
  readonly audit: AuditSink;
  /** ADR 0010 gives administrators a read of the trail; nobody else has one. */
  readonly auditTrail: AuditReader;
  readonly outbox: Outbox;
};

export type UnitOfWork = {
  run<T>(actor: Actor, work: (session: Session) => Promise<T>): Promise<T>;
};
