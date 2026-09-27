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
