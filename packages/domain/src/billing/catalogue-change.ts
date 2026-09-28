import type { PlanVersionId } from "../model/ids.ts";
import { compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { compareTerms, takesValueAway, type Plan, type PlanTerms, type TermsChange } from "./plan.ts";
import { moveTakesEffectOn, type Subscription } from "./subscription.ts";

/**
 * Changing what a Plan offers (ADR 0020, ADR 0021). A change that only gives
 * applies to every edition at once; one that takes anything — even while it
 * gives something else — becomes a new edition, which new Businesses join at
 * once and existing ones move to at their first renewal after thirty days'
 * Notice. Cancelling it, while nobody has moved yet, is as if it never was.
 */

export type ChangeKind = "NONE" | "GIVES" | "TAKES";

export const classifyChange = (from: PlanTerms, to: PlanTerms): { kind: ChangeKind; change: TermsChange } => {
  const change = compareTerms(from, to);
  const nothing =
    change.featuresAdded.length === 0 &&
    change.featuresRemoved.length === 0 &&
    change.allowance === null &&
    change.price === null;
  if (nothing) return { kind: "NONE", change };
  return { kind: takesValueAway(change) ? "TAKES" : "GIVES", change };
};

/** Which Plan an edition belongs to, for the Subscriptions a change reaches. */
export type EditionsOf = (id: PlanVersionId) => Plan | null;

/**
 * Where one Subscription stands once a Plan's new edition is announced, or
 * null when the change does not reach it.
 *
 * - On an older edition of the Plan: it moves to the new one at its first
 *   renewal at least thirty days away — unless the owner is already leaving
 *   the Plan, whose own move stands.
 * - Moving into the Plan by the owner's own choice: that move now lands on
 *   the new edition, on the later of its day and the Notice's thirty days.
 */
export const moveToEdition = (
  subscription: Subscription,
  input: { plan: Plan; editionId: PlanVersionId; planOf: EditionsOf; noticedOn: LocalDate },
): Subscription | null => {
  const onPlan = input.planOf(subscription.planVersionId) === input.plan;
  const move = subscription.scheduledMove;
  const movingTo = move === null ? null : input.planOf(move.planVersionId);
  const due = moveTakesEffectOn(subscription, input.noticedOn);

  if (onPlan && subscription.planVersionId !== input.editionId) {
    if (move !== null && movingTo !== input.plan) return null;
    return { ...subscription, scheduledMove: { planVersionId: input.editionId, effectiveOn: due } };
  }
  if (!onPlan && move !== null && movingTo === input.plan && move.planVersionId !== input.editionId) {
    const effectiveOn = compareLocalDate(move.effectiveOn, due) >= 0 ? move.effectiveOn : due;
    return { ...subscription, scheduledMove: { planVersionId: input.editionId, effectiveOn } };
  }
  return null;
};

/**
 * Where one Subscription stands once a pending edition is withdrawn, or null
 * when it was not in the change. Whoever joined the withdrawn edition goes
 * back to the one before — which only ever gives them value — and whoever was
 * moving to it stays where they are, or keeps moving into the Plan on the
 * edition that stands again.
 */
export const backFromEdition = (
  subscription: Subscription,
  input: { withdrawnId: PlanVersionId; previousId: PlanVersionId; plan: Plan; planOf: EditionsOf },
): Subscription | null => {
  const move = subscription.scheduledMove;
  if (subscription.planVersionId === input.withdrawnId) {
    return { ...subscription, planVersionId: input.previousId };
  }
  if (move === null || move.planVersionId !== input.withdrawnId) return null;
  const onPlan = input.planOf(subscription.planVersionId) === input.plan;
  return {
    ...subscription,
    scheduledMove: onPlan ? null : { planVersionId: input.previousId, effectiveOn: move.effectiveOn },
  };
};

/** Whether a Subscription's pending move is the Catalogue's, onto a new edition of its own Plan. */
export const isEditionMove = (subscription: Subscription, planOf: EditionsOf): boolean => {
  const move = subscription.scheduledMove;
  if (move === null) return false;
  const current = planOf(subscription.planVersionId);
  return current !== null && current === planOf(move.planVersionId);
};
