import {
  changePlan,
  compareTerms,
  upgradeDaysOwed,
  isOnOffer,
  validationFailed,
  type BusinessId,
  type Instant,
  type LocalDate,
  type Plan,
  type PlanVersion,
  type Resource,
  type ResourceId,
  type Subscription,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import { endIncludedAddons } from "./addons.ts";
import { resumeWithinAllowance } from "./allowance.ts";
import { currentVersionOf, entitlementOf, subscriptionView, type SubscriptionView } from "./billing.ts";
import { tell } from "./notices.ts";

/**
 * Moving a Business to another Plan, by the owner's rule (ADR 0020) — an
 * upgrade at once, a downgrade at the renewal unless nothing was paid for —
 * and what that does to its calendars (ADR 0019).
 *
 * One routine for the owner and the administrator, so the two can never move a
 * Business differently. They differ in one respect: an owner moving to a Plan
 * with room for fewer calendars says which stay, while an administrator may
 * move first and settle the calendars after, with the owner.
 */
export const movePlan = async (
  repositories: Repositories,
  input: {
    businessId: BusinessId;
    plan: Plan;
    /** The calendars that stay, when the Plan has room for fewer than are on offer. */
    keep: readonly ResourceId[] | undefined;
    by: "OWNER" | "ADMINISTRATOR";
    today: LocalDate;
    now: Instant;
  },
): Promise<SubscriptionView> => {
  const { businessId } = input;
  const [view, target, plansHeld] = await Promise.all([
    subscriptionView(repositories, businessId, input.today),
    currentVersionOf(repositories, input.plan),
    repositories.subscriptions.plansHeld(businessId),
  ]);
  // A move onto a new edition of the Plan held is the Catalogue's, and stands.
  const changed = changePlan(view.subscription, { from: view.planVersion, to: target, scheduled: view.scheduledVersion });

  const resources = await repositories.resources.listForBusiness(businessId);
  // Whatever an earlier choice marked to pause no longer stands: this move, or
  // its withdrawal, says afresh what happens to each calendar.
  await repositories.resources.setPauseOn(
    resources.filter((resource) => resource.pauseOn !== null).map((resource) => resource.id),
    null,
  );

  const onOffer = resources.filter(isOnOffer);
  const shrinking = input.plan !== view.planVersion.plan && target.terms.resourceAllowance < onOffer.length;
  const leaving = shrinking ? leavingOffer(onOffer, input, target) : [];
  const others = leaving.map((resource) => resource.id);
  if (changed.scheduledMove === null) {
    await repositories.resources.setPaused(others, input.now);
  } else {
    await repositories.resources.setPauseOn(others, changed.scheduledMove.effectiveOn);
  }

  const terms = { planVersionId: changed.planVersionId, scheduledMove: changed.scheduledMove };
  if (input.by === "OWNER") {
    await repositories.subscriptions.setPlanAsOwner(businessId, terms);
  } else {
    await repositories.subscriptions.update(businessId, terms);
  }

  if (changed.scheduledMove === null && view.planVersion.plan !== target.plan) {
    await movedNow(repositories, { ...input, view, target, plansHeld });
  }

  await tellOfMove(repositories, {
    businessId,
    by: input.by,
    from: view,
    to: target,
    scheduledMove: changed.scheduledMove,
    pausing: leaving.map((resource) => resource.name),
    at: input.now,
  });

  // An upgrade makes room: calendars paused for the old Allowance come back by
  // themselves, as their owner was told they would.
  await resumeWithinAllowance(
    repositories,
    businessId,
    await entitlementOf(repositories, businessId, input.today),
    input.now,
  );
  return subscriptionView(repositories, businessId, input.today);
};

/**
 * What a move that applies at once also does (ADR 0021): moving up again to a
 * Plan left before owes the difference for the days already paid for — only
 * the first time is paid from the next renewal — the Plan is remembered as
 * held, and any Add-on it includes stops costing anything extra.
 */
const movedNow = async (
  repositories: Repositories,
  move: {
    businessId: BusinessId;
    by: "OWNER" | "ADMINISTRATOR";
    view: SubscriptionView;
    target: PlanVersion;
    plansHeld: readonly Plan[];
    today: LocalDate;
    now: Instant;
  },
): Promise<void> => {
  const { businessId, view, target, today } = move;
  const owed = upgradeDaysOwed({ from: view.planVersion, to: target, subscription: view.subscription, plansHeld: move.plansHeld, today });
  if (owed !== null) await repositories.daysOwed.add({ businessId, kind: "PLAN_DAYS", subject: target.plan, ...owed });
  // A Trial is not paid time: only moves made while paying are remembered.
  if (view.subscription.paidThrough !== null) await repositories.subscriptions.holdPlan(businessId, target.plan);
  await endIncludedAddons(repositories, {
    businessId,
    plan: target.plan,
    features: target.terms.features,
    asOwner: move.by === "OWNER",
    today,
    at: move.now,
  });
};

/**
 * The calendars that stop taking bookings when a Business moves to a Plan with
 * room for fewer: every one on offer but those chosen to stay. An owner has to
 * choose; an administrator may move first and settle it with the owner after,
 * in which case nothing leaves yet.
 */
const leavingOffer = (
  onOffer: readonly Resource[],
  input: { keep: readonly ResourceId[] | undefined; by: "OWNER" | "ADMINISTRATOR" },
  target: PlanVersion,
): readonly Resource[] => {
  const keep = [...new Set(input.keep ?? [])];
  const { resourceAllowance } = target.terms;
  if (keep.length === 0) {
    if (input.by === "OWNER") throw validationFailed("Choose which calendars stay", { resourceAllowance });
    return [];
  }
  if (keep.length > resourceAllowance) {
    throw validationFailed("More calendars chosen than the plan allows", { resourceAllowance });
  }
  if (keep.some((id) => !onOffer.some((resource) => resource.id === id))) {
    throw validationFailed("Only a calendar on offer can be kept");
  }
  return onOffer.filter((resource) => !keep.includes(resource.id));
};

/**
 * What the owner is told of a move (ADR 0020): what it gives and takes when it
 * applies now, the day it lands when it waits for the renewal, and nothing new
 * when it is withdrawn — only the reminder of it ends.
 */
const tellOfMove = async (
  repositories: Repositories,
  move: {
    businessId: BusinessId;
    by: "OWNER" | "ADMINISTRATOR";
    from: SubscriptionView;
    to: PlanVersion;
    scheduledMove: Subscription["scheduledMove"];
    pausing: readonly string[];
    at: Instant;
  },
): Promise<void> => {
  const { businessId, by, from, to, at } = move;
  if (from.planVersion.plan === to.plan) {
    // Only the owner's own move is withdrawn; the Catalogue's stands.
    if (from.subscription.scheduledMove !== null && move.scheduledMove === null) {
      await repositories.notices.clear(businessId, ["MOVE_SOON"], at);
    }
    return;
  }
  if (move.scheduledMove !== null) {
    await tell(repositories, {
      businessId,
      facts: { kind: "MOVE_SCHEDULED", plan: to.plan, by, effectiveOn: move.scheduledMove.effectiveOn, pausing: move.pausing },
      at,
    });
    return;
  }
  const change = compareTerms(from.planVersion.terms, to.terms);
  await tell(repositories, {
    businessId,
    facts: {
      kind: "PLAN_CHANGED",
      plan: to.plan,
      by,
      priceMinor: to.terms.price,
      resourceAllowance: to.terms.resourceAllowance,
      gained: change.featuresAdded,
      lost: change.featuresRemoved,
    },
    at,
  });
  // An owner chose these themselves a moment ago; an administrator's choice is
  // news to them.
  if (by === "ADMINISTRATOR" && move.pausing.length > 0) {
    await tell(repositories, {
      businessId,
      facts: { kind: "CALENDARS_PAUSED", names: move.pausing, resourceAllowance: to.terms.resourceAllowance },
      at,
    });
  }
};

/**
 * The day's scheduled moves, carried out: each Subscription onto the edition it
 * was moving to, the calendars marked for that day paused, and any room an
 * upgrade made filled from what was paused.
 */
export const applyDueMoves = async (
  repositories: Repositories,
  today: LocalDate,
  now: Instant,
): Promise<{ readonly moved: readonly BusinessId[]; readonly paused: readonly ResourceId[] }> => {
  const due = await repositories.subscriptions.listDueMoves(today);
  for (const subscription of due) {
    const move = subscription.scheduledMove;
    /* istanbul ignore next -- listDueMoves returns only Subscriptions with a move */
    if (move === null) continue;
    await repositories.subscriptions.update(subscription.businessId, {
      planVersionId: move.planVersionId,
      scheduledMove: null,
    });
  }
  const toPause = await repositories.resources.listDueToPause(today);
  const ids = toPause.map((resource) => resource.id);
  await repositories.resources.setPaused(ids, now);
  await repositories.resources.setPauseOn(ids, null);
  for (const subscription of due) {
    const move = subscription.scheduledMove;
    /* istanbul ignore next -- listDueMoves returns only Subscriptions with a move */
    if (move === null) continue;
    const [version, previous] = await Promise.all([
      repositories.planVersions.findById(move.planVersionId),
      repositories.planVersions.findById(subscription.planVersionId),
    ]);
    if (version !== null) {
      if (subscription.paidThrough !== null) await repositories.subscriptions.holdPlan(subscription.businessId, version.plan);
      await endIncludedAddons(repositories, {
        businessId: subscription.businessId,
        plan: version.plan,
        features: version.terms.features,
        asOwner: false,
        today,
        at: now,
      });
      await tell(repositories, {
        businessId: subscription.businessId,
        // A new edition of the Plan held is the Catalogue's change landing,
        // not a move the owner made.
        facts:
          previous?.plan === version.plan
            ? { kind: "EDITION_APPLIED", plan: version.plan }
            : {
                kind: "MOVE_APPLIED",
                plan: version.plan,
                paused: toPause
                  .filter((resource) => resource.businessId === subscription.businessId)
                  .map((resource) => resource.name),
              },
        at: now,
      });
    }
    await resumeWithinAllowance(
      repositories,
      subscription.businessId,
      await entitlementOf(repositories, subscription.businessId, today),
      now,
    );
  }
  return { moved: due.map((subscription) => subscription.businessId), paused: ids };
};
