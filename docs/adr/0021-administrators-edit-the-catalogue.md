# 21. Administrators edit the Catalogue

Date: 2026-09-26

## Status

Accepted. Extends ADR 0010.

## Context

ADR 0010 kept the administrator's scope deliberately small, because an
administrator is a phone number (ADR 0004) acting over a connection that bypasses
Row Level Security (ADR 0007). Every capability granted is one an attacker gains
by taking that number.

Pricing changes are expected to be frequent enough, and made by people who do not
write code, that routing each through a commit and a deploy would be the thing
that stops them happening. The Catalogue — Plans, their Features, prices, Resource
Allowances, Add-ons, Previews and the unit rates behind the Cost Calculator — is
the largest capability yet: one edit can raise the price for every Business.

## Decision

Administrators may edit the Catalogue and issue Grants from the admin panel.
Saving a change that takes value away creates the Plan Version and schedules its
Notices (ADR 0020) without further steps.

**The Notice period is the safeguard.** A change that takes value away reaches no
existing customer for thirty days, and any administrator may cancel it until then.
Every Catalogue edit and every Grant is audited (ADR 0006) with its author.

A second administrator's approval for value-removing changes was considered and
rejected for now: with one or two administrators it blocks work more than it
protects. It is the natural next step once there are more.

Changes that add value apply at once and are not held. They cannot harm a
customer; at worst they cost the platform, and they are audited.

## Consequences

- A compromised administrator can publish a harmful change, but not deliver it
  unnoticed: every affected owner receives a Notice thirty days before it applies.
- A Grant must carry a reason and an end date; there is no permanent exception.
  Anything meant to last becomes a Plan Version.
- The list of Features is still code (ADR 0019). An administrator can place,
  price and withdraw Features, but cannot invent one.

## Grants and Unit Rates in practice (2026-09-27)

- **One list of Features per Business.** The administrator's Business sheet and
  the owner's subscription card show every Feature with where it comes from —
  the Plan, a Grant, a Preview, or nowhere — so the two never disagree.
- **Several at once.** Granting takes any number of Features with one end date
  and one reason; each becomes its own Grant, so each can be extended or ended
  alone. Only a Feature the Business has no other way can be granted.
- **At most a year ahead**, and ending early is allowed. Ending a Grant makes
  yesterday its last day: new use stops today, and nothing made with it is
  touched (ADR 0019).
- **The owner is told in the app only** — given (one Notice however many
  Features), extended, a reminder a week before the end, ended early. None of it
  is about paying, so none of it goes to WhatsApp (ADR 0020).
- **A Unit Rate entered for a unit and day that already has one replaces it.**
  The audit log keeps the earlier figure; Usage Records are never rewritten
  (ADR 0022).

## Editing Plans in practice (2026-09-28)

- **The editor classifies, not the administrator.** One sheet edits a Plan's
  price, calendars and Features; the domain's own rule says, as it is typed,
  whether the change gives value (applies to every edition at once) or takes
  any (a new edition), and the server applies the same rule on saving.
- **A lower price gives value**: it applies at once, and owners are told in the
  app only.
- **One pending change that takes value per Plan.** A second waits until the
  first has landed or been cancelled; a change that gives can always be made,
  and is carried onto the pending edition too.
- **Cancellable until the first existing Business moves.** Cancelling withdraws
  the edition — it is kept, never current again — and moves everyone back as
  ADR 0020 says; after the first move, the way back is a new change.
- **A move the Catalogue scheduled is not the owner's to withdraw.** Choosing
  the Plan already held withdraws only the owner's own move.
- **Seeing it all:** "All plans side by side" lists every edition in use with
  what changed marked, a Plan's card compares its own editions, and the
  Businesses list filters by edition.

## Features and Previews in practice (2026-09-28)

- **A Features tab** shows each Feature: which Plans include it (by edition),
  whether it is in Preview, and how many Businesses have it through a Plan, a
  Grant or a Preview. Each count opens the Businesses list filtered by that
  Feature and source; each row there also says how many Features it has by Grant.
- **Starting a Preview** gives the Feature to every Plan that lacks it, for 30
  to 365 days, and tells only those Businesses, in the app. A Feature every
  Plan has, or one already in Preview, cannot start one. A Preview can be
  extended later, never shortened.
- **Where the Feature goes is decided once, per Plan.** A Plan that keeps it
  gets it now — it gives value, so it is added to that Plan's standing
  editions. A Plan that loses it is told at once, in the app and on WhatsApp
  (ADR 0020 treats losing value like a price rise), with a reminder a week
  before the end; if the end is under thirty days away, it moves out to thirty.
- **An undecided Preview never ends by default.** When fewer than thirty days
  remain and nobody has decided, it is carried on by thirty days, so no Plan
  loses a Feature without being told in time.

## Add-ons in practice (2026-09-29)

- **Selling one** is a Feature card's "sell as Add-on": one flat monthly price,
  offered to every Plan that lacks the Feature, at most two on sale. The
  Businesses that could buy it hear of it in the app. A Feature in Preview goes
  on sale only as the Preview's end is decided, to the Plans losing it — and
  anyone adding it then pays only from the renewal after the Preview ends. A
  Feature on sale is not previewed: that would give free what some pay for.
- **The owner adds and cancels their own**, on their subscription page, and an
  administrator does the same for an owner who phones in, by the same rules and
  with the same Notices. Cancelling keeps it to the end of what is paid for,
  and can be withdrawn until then.
- **Only the first time is free until the next payment.** Adding back an Add-on
  the Business had before is paid from that day — the Days Owed, counted by
  thirtieths of the price, owed with the next payment. Otherwise adding,
  cancelling and adding again would never pay for a day. Moving up again to a
  Plan left before follows the same rule (ADR 0020).
- **A lower price gives**: it reaches everyone at once. **A higher one takes**:
  each holder pays it from their first renewal at least thirty days on, told
  now on WhatsApp too, since it is about paying; new buyers pay it at once. One
  rise waits at a time, and it can be withdrawn until the first holder pays it.
- **Stopping the sale takes nothing**: those who hold it keep it at their price
  until they cancel.
- **A Plan that comes to include it ends it** — the owner moving up, or the
  Catalogue adding it to their Plan — and they stop paying for it. Once every
  Plan includes it, its sale stops.
- **What the next payment comes to is worked out, line by line** — the Plan as
  it will be on the day, each Add-on still held then, and the Days Owed. The
  owner sees it before agreeing to anything; the administrator records a
  payment with it prefilled.
- **Which plans**, on each Feature's card, places a Feature by exactly the rule
  a Plan's own editor follows: including it gives and applies to every edition
  now, leaving it out takes and is a new edition with thirty days' Notice.
