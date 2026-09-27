import type { BusinessId, Instant, PaymentNoticeFacts } from "@tor-now/domain";

/**
 * ADR 0005. All outbound messaging goes through this port, with swappable
 * adapters, and delivery never happens inside the originating transaction —
 * messages are enqueued to an outbox row written alongside the event that
 * caused them, and drained by a worker.
 */

/**
 * The approved templates. ADR 0005 named three and deferred reminders "until a
 * scheduler exists"; one exists now, and the fourth is that reminder. The
 * fifth is ADR 0018's waiting list; the sixth tells an owner about paying for
 * their Subscription (ADR 0020) — the only one sent to a Business rather than
 * a customer.
 *
 * The set stays closed on purpose: Meta bills per delivered template message
 * and approves each one, so adding a seventh is a conversation with Meta rather
 * than a line of code — and the waiting-list one is the first whose volume
 * grows with how many people are waiting rather than with what happened, which
 * is why a Business can switch it off.
 */
export const TEMPLATES = {
  bookingConfirmed: "BOOKING_CONFIRMED",
  bookingCancelled: "BOOKING_CANCELLED",
  bookingRescheduled: "BOOKING_RESCHEDULED",
  bookingReminder: "BOOKING_REMINDER",
  waitingListOpening: "WAITING_LIST_OPENING",
  billingNotice: "BILLING_NOTICE",
} as const;

export type Template = (typeof TEMPLATES)[keyof typeof TEMPLATES];

/** The templates a customer receives about a booking or a wait. */
export type CustomerTemplate = Exclude<Template, typeof TEMPLATES.billingNotice>;

export type NotificationPayload = {
  readonly businessName: string;
  readonly serviceName: string;
  readonly startAt: string;
  readonly customerName: string;
  readonly businessPhone: string;
  readonly previousStartAt?: string;
  /**
   * Only the waiting-list opening. It names the part of the day rather than
   * the hour, because by the time anybody reads it the exact hour may be gone
   * and a wrong specific is worse than a right general — and it names the
   * calendar, because the customer was offered "either of them" and cannot
   * work out for themselves which one freed.
   */
  readonly partOfDay?: string;
  readonly resourceName?: string;
  /**
   * The day itself, as the Business's own calendar has it. The waiting-list
   * message names a part of a day rather than an hour, and `startAt` is an
   * Instant — rendering one where a date belongs puts an ISO timestamp in
   * front of a customer.
   */
  readonly onDate?: string;
};

/**
 * One sentence about the owner's Subscription, filled into a fixed frame. The
 * facts travel rather than the sentence, so the wording is the renderer's —
 * the same place every other template's wording lives.
 */
export type BillingNoticePayload = {
  readonly businessName: string;
  /** Only a Notice about paying goes out on WhatsApp (ADR 0020). */
  readonly facts: PaymentNoticeFacts;
};

type Addressed = {
  /** Whose message it is — the Business its delivery is charged to. */
  readonly businessId: BusinessId;
  readonly recipientPhone: string;
};

export type CustomerMessage = Addressed & {
  readonly template: CustomerTemplate;
  readonly payload: NotificationPayload;
};

export type BillingNoticeMessage = Addressed & {
  readonly template: typeof TEMPLATES.billingNotice;
  readonly payload: BillingNoticePayload;
};

export type OutboundMessage = CustomerMessage | BillingNoticeMessage;

export const isToCustomer = (message: OutboundMessage): message is CustomerMessage =>
  message.template !== TEMPLATES.billingNotice;

export const isBillingNotice = (message: OutboundMessage): message is BillingNoticeMessage =>
  message.template === TEMPLATES.billingNotice;

export const DELIVERY_CHANNELS = ["WHATSAPP", "SMS", "LOG"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * What an adapter reports back; the worker records it against the outbox row.
 * `units` is what the provider bills for it: one WhatsApp template, or however
 * many segments an SMS was split into.
 */
export type DeliveryResult =
  | { readonly delivered: true; readonly via: DeliveryChannel; readonly units: number }
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
