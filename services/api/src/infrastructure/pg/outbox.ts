import { instant } from "@tor-now/domain";
import { OUTBOX } from "../../config.ts";
import type {
  NotificationPayload,
  Outbox,
  OutboxEntry,
  Template,
} from "../../ports/notifier.ts";
import type { Transaction } from "./client.ts";
import type { Row } from "./mappers.ts";

/**
 * ADR 0005: the row is written in the transaction that caused it, so a
 * messaging outage delays notifications but never rolls back or loses the
 * booking that triggered them.
 */
export const outbox = (tx: Transaction): Outbox => ({
  async enqueue(message) {
    await tx`
      select app.enqueue_notification(
        ${message.recipientPhone},
        ${message.template},
        ${JSON.stringify(message.payload)}::jsonb)`;
  },

  /**
   * `for update skip locked` is what lets more than one worker drain the
   * outbox without two of them claiming the same row.
   */
  async claimPending(limit): Promise<readonly OutboxEntry[]> {
    const rows = await tx<Row[]>`
      select * from notification_outbox
      where status = 'PENDING'
        and (retry_after is null or retry_after <= now())
      order by created_at
      limit ${limit}
      for update skip locked`;
    return rows.map((row) => ({
      id: String(row["id"]),
      attempts: Number(row["attempts"]),
      createdAt: instant(new Date(row["created_at"] as string).getTime()),
      message: {
        recipientPhone: String(row["recipient_phone"]),
        template: String(row["template"]) as Template,
        payload: row["payload"] as NotificationPayload,
      },
    }));
  },

  async markSent(id, via) {
    await tx`
      update notification_outbox
      set status = 'SENT', delivered_at = now(), delivered_via = ${via},
          attempts = attempts + 1
      where id = ${id}`;
  },

  async markFailed(id, reason, retryAfter) {
    await tx`
      update notification_outbox
      set status = ${retryAfter === null ? "FAILED" : "PENDING"},
          attempts = attempts + 1,
          last_error = ${reason},
          retry_after = ${retryAfter === null ? null : new Date(retryAfter)}
      where id = ${id}`;
  },
});

export const hasExhaustedAttempts = (attempts: number): boolean =>
  attempts + 1 >= OUTBOX.maxAttempts;
