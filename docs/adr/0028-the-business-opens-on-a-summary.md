# 28. A business opens on a summary and one next step

Date: 2026-10-10

## Status

Accepted.

## Context

The wizard ended on a small "באוויר" chip and a sentence that told the owner to
start sharing the link, with no way to share it. Nothing said what had been
made, when the Trial ends, or — for an owner whose Trial went to an earlier
business — that paying was now the one thing that mattered.

## Decision

The screen after "סיום" takes the booked screen's shape: a navy band with the
business's name, a read-only summary card, a short timeline of what is done and
what comes next, and "ליומן שלי" pinned at the bottom.

- **Read-only.** It summarises what the wizard saved: the first service and how
  many more, up to three calendars and how many more, the hours grouped by the
  days that keep them, the plan and when its Trial ends (read from the server's
  Subscription; left off if that read fails). Nothing on it edits or removes the
  business; that stays in the business panel.
- **One next step.** With a Trial, it is sharing: the device's share sheet where
  there is one, otherwise the page's own; "שיתוף בוואטסאפ" (worded as sharing,
  so nobody takes it for a chat with us), copying the link, and a QR code.
  Without a Trial it is paying, before the deadline the nightly run enforces;
  "לתשלום" opens WhatsApp with the team, since no money moves through the app
  (ADR 0019). Sharing waits until then.
- **Going live is unchanged.** A business is in search the moment it registers
  (ADR 0011), Trial or not; an unpaid one leaves at the next deactivation run.
- **The QR card** is drawn in the browser: A6 at 300 dpi, the code at error
  correction level H with its centre cleared for the logo (a fifth of its side —
  the code still scans with twice that cleared), the business's name under it in
  the language of the name's own letters, three steps, and a fallback to search
  by name. It downloads as a PNG, or is shared as a picture where the device
  takes files.
- **Leaving it** — the back arrow or "ליומן שלי" — goes into the business. The
  screen is not shown again.

## Consequences

The screen lives in memory only: a reload after "סיום" lands on the wizard's
start rather than this summary, which is acceptable for a once-only moment.
A photo that failed to upload after registering is said there, quietly, with
where to add it.
