import { addMinutesToInstant, type Clock, type Instant } from "@tor-now/domain";
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

/**
 * When a message that has just failed its Nth attempt may be tried again, or
 * null once there is nothing left to try. The schedule lives in config; this
 * only decides which entry of it applies, and holds the last one for any
 * attempt beyond its length.
 */
const retryAfter = (attemptsSoFar: number, now: Instant): Instant | null => {
  const madeNow = attemptsSoFar + 1;
  if (madeNow >= OUTBOX.maxAttempts) return null;
  const schedule = OUTBOX.retryAfterMinutes;
  const wait = schedule[Math.min(madeNow - 1, schedule.length - 1)] ?? schedule[0];
  return addMinutesToInstant(now, wait);
};

export const outboxWorker = (dependencies: {
  unitOfWork: UnitOfWork;
  notifier: Notifier;
  clock: Clock;
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
        const nextAttempt = retryAfter(entry.attempts, dependencies.clock.now());
        return { entry, result, nextAttempt };
      }),
    );

    await dependencies.unitOfWork.run(system(), async ({ outbox }) => {
      await Promise.all(
        outcomes.map(({ entry, result, nextAttempt }) =>
          result.delivered
            ? outbox.markSent(entry.id, result.via)
            : outbox.markFailed(entry.id, result.reason, nextAttempt),
        ),
      );
    });

    const delivered = outcomes.filter((outcome) => outcome.result.delivered).length;
    const abandoned = outcomes.filter(
      (outcome) => !outcome.result.delivered && outcome.nextAttempt === null,
    ).length;

    return {
      claimed: claimed.length,
      delivered,
      failed: outcomes.length - delivered,
      abandoned,
    };
  },
});
