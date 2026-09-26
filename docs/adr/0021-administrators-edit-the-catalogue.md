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
