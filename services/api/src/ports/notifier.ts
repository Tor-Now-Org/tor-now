import type { Instant } from "@tor-now/domain";

/**
 * ADR 0005. All outbound messaging goes through this port, with swappable
 * adapters, and delivery never happens inside the originating transaction —
 * messages are enqueued to an outbox row written alongside the event that
 * caused them, and drained by a worker.
 */

/**
 * The approved templates. ADR 0005 named three and deferred reminders "until a
 * scheduler exists"; one exists now, and the fourth is that reminder.
 *
 * The set stays closed on purpose: Meta bills per delivered template message
 * and approves each one, so adding a fifth is a conversation with Meta rather
 * than a line of code.
 */
export const TEMPLATES = {
  bookingConfirmed: "BOOKING_CONFIRMED",
  bookingCancelled: "BOOKING_CANCELLED",
  bookingRescheduled: "BOOKING_RESCHEDULED",
  bookingReminder: "BOOKING_REMINDER",
} as const;

export type Template = (typeof TEMPLATES)[keyof typeof TEMPLATES];

export type NotificationPayload = {
  readonly businessName: string;
  readonly serviceName: string;
  readonly startAt: string;
  readonly customerName: string;
  readonly businessPhone: string;
  readonly previousStartAt?: string;
};

export type OutboundMessage = {
  readonly recipientPhone: string;
  readonly template: Template;
  readonly payload: NotificationPayload;
};

export const DELIVERY_CHANNELS = ["WHATSAPP", "SMS", "LOG"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** What an adapter reports back; the worker records it against the outbox row. */
export type DeliveryResult =
  | { readonly delivered: true; readonly via: DeliveryChannel }
  | { readonly delivered: false; readonly reason: string };

export type Notifier = {
  deliver(message: OutboundMessage): Promise<DeliveryResult>;
};

/** Enqueued in the same transaction as the event; drained by the worker. */
export type OutboxEntry = {
  readonly id: string;
  readonly message: OutboundMessage;
  readonly attempts: number;
  readonly createdAt: Instant;
};

export type Outbox = {
  enqueue(message: OutboundMessage): Promise<void>;
  claimPending(limit: number): Promise<readonly OutboxEntry[]>;
  markSent(id: string, via: DeliveryChannel): Promise<void>;
  /**
   * `retryAfter` is when this may be attempted again, or null when there is
   * nothing left to try and the message is abandoned. One argument rather than
   * a boolean and a time, because "give up" and "wait until" are the same
   * decision seen from two sides.
   */
  markFailed(id: string, reason: string, retryAfter: Instant | null): Promise<void>;
};
