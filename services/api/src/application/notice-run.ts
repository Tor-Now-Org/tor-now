import { addDays, noticesDue, timeZone, todayIn, type Instant, type Notice, type Plan, type PlanVersionId } from "@tor-now/domain";
import type { Session } from "../ports/unit-of-work.ts";
import { announce } from "./notices.ts";

/**
 * The daily run's Notices (ADR 0020): a Trial or a Grant ending within the week, a payment
 * late, a move landing within the week — worked out per Business against its
 * own today. Saying the same thing twice keeps nothing twice, so a run that
 * repeats or follows a missed day is safe.
 *
 * Returns how many Notices were new.
 */
export const announceDue = async (
  session: Pick<Session, "repositories" | "outbox">,
  now: Instant,
): Promise<number> => {
  const { repositories } = session;
  // A day early: each Business's own today decides which Grants still run.
  const [entries, versions, grants, previews] = await Promise.all([
    repositories.subscriptions.directory(),
    repositories.planVersions.listAll(),
    repositories.grants.listRunning(addDays(todayIn(now, timeZone("UTC")), -1)),
    repositories.previews.listEntries(),
  ]);
  const planOf = new Map<PlanVersionId, Plan>(versions.map((version) => [version.id, version.plan]));
  const editionOf = new Map(versions.map((version) => [version.id, version]));
  // Decided Previews whose Feature a Plan does not keep: its Businesses are
  // reminded before the Feature leaves, unless their edition has it anyway.
  const leavingFor = (versionId: PlanVersionId) => {
    const edition = editionOf.get(versionId);
    return previews.flatMap((preview) =>
      preview.placement === null ||
      edition === undefined ||
      preview.placement.keepOn.includes(edition.plan) ||
      edition.terms.features.includes(preview.feature)
        ? []
        : [{ feature: preview.feature, endsOn: preview.endsOn }],
    );
  };

  const kept: (Notice | null)[] = [];
  for (const { business, subscription } of entries) {
    const move = subscription.scheduledMove;
    const pausing =
      move === null
        ? []
        : (await repositories.resources.listForBusiness(business.id))
            .filter((resource) => resource.pauseOn === move.effectiveOn)
            .map((resource) => resource.name);
    const due = noticesDue({
      subscription,
      scheduledPlan: move === null ? null : (planOf.get(move.planVersionId) ?? null),
      currentPlan: planOf.get(subscription.planVersionId) ?? null,
      pausing,
      grants: grants.filter((grant) => grant.businessId === business.id),
      previewsLeaving: leavingFor(subscription.planVersionId),
      businessActive: business.active,
      today: todayIn(now, business.timeZone),
    });
    for (const facts of due) {
      kept.push(await announce(session, { businessId: business.id, facts, at: now }));
    }
  }
  return kept.filter((notice) => notice !== null).length;
};
