# 5. WhatsApp-primary notifications behind a channel port

Date: 2026-08-24

## Status

Accepted

## Context

Verification codes, booking confirmations and cancellation notices all need a
delivery channel. Email was considered and rejected: the product targets a market
where WhatsApp is the norm, and maintaining a channel nobody reads is waste.

Meta bills per delivered template message. That fee is identical regardless of
which Business Solution Provider is used; providers differ only in markup. Meta
prices authentication templates as its cheapest category, while utility templates
— which booking confirmations fall under — cost more. The dominant cost is
therefore confirmations, not logins.

No sustainable free production tier for SMS exists. Offerings advertised as free
are expiring trial credits or sandboxes restricted to pre-verified numbers.

## Decision

All outbound messaging goes through a `Notifier` port with swappable adapters:

- `LogNotifier` — development and staging. Writes codes and messages to the log.
- `WhatsAppNotifier` — production primary.
- `SmsNotifier` — production fallback, used when WhatsApp delivery fails.

Messages are enqueued to an outbox row written in the same transaction as the
event that caused them, and delivered by a worker. Delivery never happens inside
the originating transaction.

Events that notify: booking confirmations, cancellations, and reschedules —
three approved templates. Verification codes are delivered by Twilio Verify via
Supabase Auth and do not pass through this port. Reminders are deferred until a
scheduler exists.

The BSP choice is deferred to launch. A Twilio trial account is used during
development for real-device delivery testing.

## Consequences

- Development and QA cost nothing, and no vendor is chosen before it is needed.
- Switching BSP is a configuration change, so a decision made for launch pricing
  can be revisited without touching the domain.
- SMS fallback is inexpensive in practice because it fires only when WhatsApp
  fails, not because SMS is cheap per message.
- The outbox means a messaging outage delays notifications but never rolls back or
  loses the booking or cancellation that triggered them.
- Two items have external lead times and must start before they are needed: Meta
  authentication template approval, and Israeli SMS sender registration.
- Session lifetime is a cost lever, since each new login costs a message. ADR 0009
  sets it at thirty days for every role, which is shorter than the interval between
  a typical customer's visits — so re-logins drive message volume alongside new
  customers and confirmations.
