# 19. Billing states an Entitlement; Scheduling enforces it

Date: 2026-09-26

## Status

Accepted

## Context

Until now Billing and Scheduling met at one point: Deactivation. Billing knew
nothing of Resources, Services or Appointments, and a Subscription's plan changed
nothing about what a Business could do.

Pricing now depends on exactly those things. Solo and Team differ in how many
Resources a Business may keep, and every Feature shipped from here on has to be
sellable — placed in a Plan, sold as an Add-on, or offered as a Preview — without
the code that implements it knowing anything about prices.

Three shapes were considered. Scheduling could read the Subscription's Plan and
interpret it, which puts `plan === "TEAM"` checks throughout Scheduling and turns
every pricing change into a code change. The two contexts could be merged, which
gives up the one boundary that keeps billing mistakes out of booking logic. Or
Billing could state a result and let Scheduling decide what it means.

## Decision

Billing publishes an **Entitlement** for a Business: the set of Features it holds
and its Resource Allowance. This is the second channel between the contexts,
beside Deactivation, and there is no third.

**Billing knows a Feature by name only.** Scheduling decides what each Feature
means and enforces it. Billing learns of Resources only as a number.

**Features exist in code; their placement is data.** A Feature cannot be sold
before it is built, so the list of Features is defined in code. Which Plans
include it, what it costs as an Add-on, and whether it is in Preview live in the
Catalogue and are edited by administrators (ADR 0021). A Feature that ships
appears in the Catalogue as placed nowhere until someone places it.

**Losing an Entitlement stops new use; it never touches what exists.** Scheduling
checks the Entitlement only when something new is started — a Resource created, a
waiting list opened. Nothing is hidden, deleted or frozen when a Feature is lost.
One check, one "upgrade" prompt, the same for every Feature.

The one exception is the Resource Allowance, where "never touches what exists"
would let a Business buy Team, open ten calendars and drop to Solo. For now an
administrator pauses the extra Resources by hand; a Paused Resource returns as it
was once the Allowance covers it again.

## Consequences

- No code outside Billing names a Plan. Moving a Feature between Plans, running a
  Preview or selling an Add-on changes data, not Scheduling.
- A Grant — one Feature for one Business, with a reason and an end date — is
  merged into the Entitlement like any Plan Feature; Scheduling cannot tell them
  apart.
- The admin panel lists Businesses above their Resource Allowance. The handling is
  manual until that list stops being short.
- `CONTEXT-MAP.md` no longer says Deactivation is the only channel.
