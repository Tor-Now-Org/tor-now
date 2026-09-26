# 20. Plan Versions, and Notice before anything is taken away

Date: 2026-09-26

## Status

Accepted

## Context

What each Plan includes has to stay under the platform's control. A Feature that
turns out to cost more than a Plan's price can bear — the obvious candidate is
anything that sends WhatsApp messages (ADR 0005) — has to be movable to a dearer
Plan or taken off one. At the same time, a Business must never discover on a
Monday that something it relied on on Friday is gone.

Metering was considered and rejected: an allowance per Feature per month makes the
product feel restrictive to owners, and pushes cost control onto the customer.
Plans are sold as packages, priced from what a busy Business costs, with a Fair
Use Limit behind them that only alerts an administrator.

Two other options were rejected. Applying every change to everyone at once is
flexible but surprises every customer on every change. Grandfathering forever
avoids surprise but leaves the platform stuck with the costly edition it was
trying to leave.

## Decision

A Plan's contents — Features, Resource Allowance, price — are held as a **Plan
Version**. A Subscription stays on the Plan Version it joined until it is moved.

**Changes that take value away** — a Feature removed or moved up, a smaller
Allowance, a higher price — create a new Plan Version. New Businesses join it at
once. Existing Subscriptions move at their first renewal at least **thirty days**
after a Notice.

**Changes that add value** — a Feature added, a larger Allowance, a lower price —
apply to the current Plan Version at once, and are announced by Notice when they
happen.

Every Notice reaches the owner three ways: a banner in the management screen until
acknowledged, a WhatsApp message, and, for a move, a reminder seven days before it
applies. The management screen keeps every Notice from Billing in one place.

**A new Feature whose cost or demand is unknown launches as a Preview**: offered on
every Plan for a stated period and labelled as unplaced. Ending a Preview is a
change that takes value away for Plans that do not keep it.

Billing is monthly only. A yearly period would mean a Business waits up to a year
to move, and every rule above would need a second case.

## Consequences

- A Plan can be changed at any time; the cost is thirty days before the change
  reaches existing customers.
- Several Plan Versions of one Plan can be live at once. The admin panel has to
  show which Subscriptions are on which.
- Upgrades apply at once and the new price starts at the next renewal. Downgrades
  apply at renewal. Payments are recorded by hand, so there is no proration.
- Fair Use is alert-only: a runaway Business costs money until an administrator
  acts. Automatic throttling was deferred as not worth its complexity yet.
