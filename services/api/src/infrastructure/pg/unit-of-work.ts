import { actorUserId, type Session, type UnitOfWork } from "../../ports/unit-of-work.ts";
import type { Repositories } from "../../ports/repositories.ts";
import { withAuditing } from "../auditing.ts";
import { auditSink } from "./audit-sink.ts";
import { assumeIdentity, type Sql, type Transaction } from "./client.ts";
import {
  administratorAllowlistRepository,
  businessRepository,
  membershipRepository,
  userRepository,
} from "./identity-repositories.ts";
import { appointmentRepository } from "./appointment-repository.ts";
import { paymentRepository, subscriptionRepository } from "./billing-repositories.ts";
import { outbox } from "./outbox.ts";
import {
  blockRepository,
  dateOverrideRepository,
  resourceRepository,
  serviceRepository,
  workingHoursRepository,
} from "./scheduling-repositories.ts";

const repositoriesOn = (tx: Transaction): Repositories => ({
  users: userRepository(tx),
  businesses: businessRepository(tx),
  memberships: membershipRepository(tx),
  resources: resourceRepository(tx),
  services: serviceRepository(tx),
  workingHours: workingHoursRepository(tx),
  dateOverrides: dateOverrideRepository(tx),
  blocks: blockRepository(tx),
  appointments: appointmentRepository(tx),
  subscriptions: subscriptionRepository(tx),
  payments: paymentRepository(tx),
  administratorAllowlist: administratorAllowlistRepository(tx),
});

/**
 * One transaction per unit of work, with the caller's identity re-established
 * on it (ADR 0007) and the auditing decorator applied (ADR 0006). The mutation,
 * its audit row and any outbox entry therefore commit together or not at all.
 *
 * This is the only place repositories are wired, which is what makes auditing a
 * composition concern rather than something every call site has to remember.
 */
export const postgresUnitOfWork = (sql: Sql): UnitOfWork => ({
  run<T>(actor: Parameters<UnitOfWork["run"]>[0], work: (session: Session) => Promise<T>) {
    return sql.begin(async (tx) => {
      await assumeIdentity(tx as Transaction, actor);
      const transaction = tx as Transaction;
      const sink = auditSink(transaction);
      return work({
        repositories: withAuditing(repositoriesOn(transaction), {
          sink,
          actorId: actorUserId(actor),
        }),
        audit: sink,
        outbox: outbox(transaction),
      });
    }) as Promise<T>;
  },
});
