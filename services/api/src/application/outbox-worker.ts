import { OUTBOX } from "../config.ts";
import type { Notifier } from "../ports/notifier.ts";
import { system, type UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * ADR 0005: messages are delivered by a worker, never inside the transaction
 * that produced them. ADR 0007 notes that serverless functions do not run
 * unprompted, so this is driven by Supabase Cron.
 */

export type DrainReport = {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly abandoned: number;
};

export const outboxWorker = (dependencies: {
  unitOfWork: UnitOfWork;
  notifier: Notifier;
}) => ({
  /**
   * Delivery happens outside the claiming transaction, so a slow provider does
   * not hold a database transaction open for the length of an HTTP call. The
   * row stays PENDING until the outcome is recorded, which means a crash
   * mid-delivery can duplicate a message — the trade the outbox pattern makes,
   * and the right one here: a duplicate confirmation is a nuisance, a lost one
   * is a customer who arrives at a business that is not expecting them.
   */
  async drain(): Promise<DrainReport> {
    const claimed = await dependencies.unitOfWork.run(system(), ({ outbox }) =>
      outbox.claimPending(OUTBOX.batchSize),
    );

    const outcomes = await Promise.all(
      claimed.map(async (entry) => {
        const result = await dependencies.notifier.deliver(entry.message);
        const giveUp = entry.attempts + 1 >= OUTBOX.maxAttempts;
        return { entry, result, giveUp };
      }),
    );

    await dependencies.unitOfWork.run(system(), async ({ outbox }) => {
      await Promise.all(
        outcomes.map(({ entry, result, giveUp }) =>
          result.delivered
            ? outbox.markSent(entry.id, result.via)
            : outbox.markFailed(entry.id, result.reason, giveUp),
        ),
      );
    });

    const delivered = outcomes.filter((outcome) => outcome.result.delivered).length;
    const abandoned = outcomes.filter(
      (outcome) => !outcome.result.delivered && outcome.giveUp,
    ).length;

    return {
      claimed: claimed.length,
      delivered,
      failed: outcomes.length - delivered,
      abandoned,
    };
  },
});
