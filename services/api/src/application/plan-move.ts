import {
  changePlan,
  isOnOffer,
  validationFailed,
  type BusinessId,
  type Instant,
  type LocalDate,
  type Plan,
  type ResourceId,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import { resumeWithinAllowance } from "./allowance.ts";
import { currentVersionOf, entitlementOf, subscriptionView, type SubscriptionView } from "./billing.ts";

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
  const view = await subscriptionView(repositories, businessId, input.today);
  const target = await currentVersionOf(repositories, input.plan);
  const changed = changePlan(view.subscription, { from: view.planVersion, to: target });

  const resources = await repositories.resources.listForBusiness(businessId);
  // Whatever an earlier choice marked to pause no longer stands: this move, or
  // its withdrawal, says afresh what happens to each calendar.
  await repositories.resources.setPauseOn(
    resources.filter((resource) => resource.pauseOn !== null).map((resource) => resource.id),
    null,
  );

  const onOffer = resources.filter(isOnOffer);
  const shrinking = input.plan !== view.planVersion.plan && target.terms.resourceAllowance < onOffer.length;
  if (shrinking) {
    const keep = [...new Set(input.keep ?? [])];
    if (keep.length === 0 && input.by === "OWNER") {
      throw validationFailed("Choose which calendars stay", {
        resourceAllowance: target.terms.resourceAllowance,
      });
    }
    if (keep.length > 0) {
      if (keep.length > target.terms.resourceAllowance) {
        throw validationFailed("More calendars chosen than the plan allows", {
          resourceAllowance: target.terms.resourceAllowance,
        });
      }
      if (keep.some((id) => !onOffer.some((resource) => resource.id === id))) {
        throw validationFailed("Only a calendar on offer can be kept");
      }
      const others = onOffer.filter((resource) => !keep.includes(resource.id)).map((resource) => resource.id);
      if (changed.scheduledMove === null) {
        await repositories.resources.setPaused(others, input.now);
      } else {
        await repositories.resources.setPauseOn(others, changed.scheduledMove.effectiveOn);
      }
    }
  }

  const terms = { planVersionId: changed.planVersionId, scheduledMove: changed.scheduledMove };
  if (input.by === "OWNER") {
    await repositories.subscriptions.setPlanAsOwner(businessId, terms);
  } else {
    await repositories.subscriptions.update(businessId, terms);
  }

  // An upgrade makes room: calendars paused for the old Allowance come back by
  // themselves, as their owner was told they would.
  await resumeWithinAllowance(repositories, businessId, await entitlementOf(repositories, businessId, input.today));
  return subscriptionView(repositories, businessId, input.today);
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
    await resumeWithinAllowance(
      repositories,
      subscription.businessId,
      await entitlementOf(repositories, subscription.businessId, today),
    );
  }
  return { moved: due.map((subscription) => subscription.businessId), paused: ids };
};
