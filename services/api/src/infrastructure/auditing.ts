import type { AddonHoldingId, BusinessId, LocalDate, ResourceId } from "@tor-now/domain";
import { AUDIT_ACTIONS } from "../ports/audit.ts";
import { auditedFairUseLimits, auditedReferenceBusinesses, auditedRunningCosts } from "./auditing-costs.ts";
import { record, type Context } from "./audit-record.ts";
import type {
  AddonHoldingRepository,
  AddonOfferRepository,
  AppointmentRepository,
  BlockRepository,
  BusinessPhotoRepository,
  BusinessRepository,
  DaysOwedRepository,
  DateOverrideRepository,
  MembershipRepository,
  MembershipResourceRepository,
  Repositories,
  ResourceRepository,
  ReviewRepository,
  ServiceRepository,
  SubscriptionRepository,
  GrantRepository,
  PlanVersionRepository,
  PreviewRepository,
  UnitRateRepository,
  UserRepository,
  WorkingHoursRepository,
} from "../ports/repositories.ts";

/**
 * ADR 0006: audit rows are produced by a decorator wrapping each repository,
 * not by call sites. Each decorator implements the same interface as the
 * repository it wraps, reads the prior state, delegates the mutation, and
 * appends the audit row — inside the same transaction, because a committed
 * change without its audit row is not an acceptable state.
 *
 * Domain services depend on the repository interface and are unaware that
 * auditing happens at all. Adding it to a new entity is a change here and in
 * the composition root, not an edit to every mutation site.
 */


export const auditedAppointments = (
  inner: AppointmentRepository,
  context: Context,
): AppointmentRepository => ({
  ...inner,
  async create(draft) {
    const created = await inner.create(draft);
    await record(
      context,
      AUDIT_ACTIONS.appointmentBooked,
      "Appointment",
      created.id,
      null,
      created,
    );
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(
      context,
      actionForAppointmentChange(changes),
      "Appointment",
      id,
      before,
      after,
    );
    return after;
  },
});

/**
 * The log is read by people asking specific questions, so a cancellation and a
 * reschedule are different actions rather than one generic update.
 */
const actionForAppointmentChange = (
  changes: Parameters<AppointmentRepository["update"]>[1],
): string => {
  if (changes.status === "CANCELLED") return AUDIT_ACTIONS.appointmentCancelled;
  if (changes.status === "NO_SHOW") return AUDIT_ACTIONS.appointmentNoShow;
  if (changes.status === "CONFIRMED" && changes.startAt === undefined) {
    return AUDIT_ACTIONS.appointmentNoShowCleared;
  }
  return AUDIT_ACTIONS.appointmentRescheduled;
};

export const auditedBusinesses = (
  inner: BusinessRepository,
  context: Context,
): BusinessRepository => ({
  ...inner,
  async create(business) {
    const created = await inner.create(business);
    await record(
      context,
      AUDIT_ACTIONS.businessRegistered,
      "Business",
      created.id,
      null,
      created,
    );
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.businessUpdated, "Business", id, before, after);
    return after;
  },
  async setActive(id, active) {
    const before = await inner.findById(id);
    const after = await inner.setActive(id, active);
    await record(
      context,
      active ? AUDIT_ACTIONS.businessActivated : AUDIT_ACTIONS.businessDeactivated,
      "Business",
      id,
      before,
      after,
    );
    return after;
  },
});

export const auditedServices = (
  inner: ServiceRepository,
  context: Context,
): ServiceRepository => ({
  ...inner,
  async create(service) {
    const created = await inner.create(service);
    await record(context, AUDIT_ACTIONS.serviceCreated, "Service", created.id, null, created);
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.serviceUpdated, "Service", id, before, after);
    return after;
  },
  async delete(id) {
    const before = await inner.findById(id);
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.serviceDeleted, "Service", id, before, null);
  },
});

/**
 * Only the writes that change what somebody may do. `create` and
 * `ensureCustomer` are how a customer arrives at a business and say nothing
 * about permission, so they stay out of the log along with `setBlocked`, which
 * the appointment trail already explains.
 */
export const auditedMemberships = (
  inner: MembershipRepository,
  context: Context,
): MembershipRepository => ({
  ...inner,
  async setRole(id, role) {
    const before = await inner.findById(id);
    const after = await inner.setRole(id, role);
    await record(
      context,
      AUDIT_ACTIONS.membershipRoleChanged,
      "Membership",
      id,
      before,
      after,
    );
    return after;
  },
  async delete(id) {
    const before = await inner.findById(id);
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.membershipRemoved, "Membership", id, before, null);
  },
});

export const auditedMembershipResources = (
  inner: MembershipResourceRepository,
  context: Context,
): MembershipResourceRepository => ({
  ...inner,
  async create(assignment) {
    const created = await inner.create(assignment);
    await record(
      context,
      AUDIT_ACTIONS.membershipResourceAssigned,
      "MembershipResource",
      created.id,
      null,
      created,
    );
    return created;
  },
  /**
   * There is no `findById` on this port and no reason to add one: the row is
   * three ids, and the id in the entry identifies it.
   */
  async delete(id) {
    await inner.delete(id);
    await record(
      context,
      AUDIT_ACTIONS.membershipResourceUnassigned,
      "MembershipResource",
      id,
      null,
      null,
    );
  },
});

export const auditedResources = (
  inner: ResourceRepository,
  context: Context,
): ResourceRepository => ({
  ...inner,
  async create(resource) {
    const created = await inner.create(resource);
    await record(context, AUDIT_ACTIONS.resourceCreated, "Resource", created.id, null, created);
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.resourceUpdated, "Resource", id, before, after);
    return after;
  },
  async delete(id) {
    const before = await inner.findById(id);
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.resourceDeleted, "Resource", id, before, null);
  },
  async setPaused(ids, at) {
    const after = await inner.setPaused(ids, at);
    await Promise.all(
      after.map((resource) =>
        record(
          context,
          at === null ? AUDIT_ACTIONS.resourceResumed : AUDIT_ACTIONS.resourcePaused,
          "Resource",
          resource.id,
          null,
          resource,
        ),
      ),
    );
    return after;
  },
});

/**
 * Billing terms were written without a trail until the Catalogue made them
 * something an administrator edits routinely (ADR 0021); a changed price or
 * plan with no author is exactly the dispute the log exists to settle.
 */
export const auditedSubscriptions = (
  inner: SubscriptionRepository,
  context: Context,
): SubscriptionRepository => ({
  ...inner,
  async start(businessId, terms) {
    const before = await inner.findByBusiness(businessId);
    const after = await inner.start(businessId, terms);
    await record(context, AUDIT_ACTIONS.subscriptionStarted, "Subscription", after.id, before, after);
    return after;
  },
  async update(businessId, changes) {
    const before = await inner.findByBusiness(businessId);
    const after = await inner.update(businessId, changes);
    await record(context, AUDIT_ACTIONS.subscriptionChanged, "Subscription", after.id, before, after);
    return after;
  },
  async setPlanAsOwner(businessId, terms) {
    const before = await inner.findByBusiness(businessId);
    const after = await inner.setPlanAsOwner(businessId, terms);
    await record(context, AUDIT_ACTIONS.subscriptionChanged, "Subscription", after.id, before, after);
    return after;
  },
});

export const auditedWorkingHours = (
  inner: WorkingHoursRepository,
  context: Context,
): WorkingHoursRepository => ({
  ...inner,
  async create(hours) {
    const created = await inner.create(hours);
    await record(
      context,
      AUDIT_ACTIONS.workingHoursChanged,
      "WorkingHours",
      created.id,
      null,
      created,
    );
    return created;
  },
  async update(id, changes) {
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.workingHoursChanged, "WorkingHours", id, null, after);
    return after;
  },
  async delete(id) {
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.workingHoursChanged, "WorkingHours", id, null, null);
  },
  async replaceForResource(resourceId, businessId, ranges) {
    // One row for the week rather than one per range: the change a person made
    // was "these are my hours now", and fourteen rows saying a range was
    // removed and another created is a worse record of it than the two weeks
    // side by side. Kept against the calendar, which is what was edited.
    const before = await inner.listForResource(resourceId);
    const after = await inner.replaceForResource(resourceId, businessId, ranges);
    await record(
      context,
      AUDIT_ACTIONS.workingHoursChanged,
      "Resource",
      resourceId,
      before,
      after,
    );
    return after;
  },
});

export const auditedDateOverrides = (
  inner: DateOverrideRepository,
  context: Context,
): DateOverrideRepository => ({
  ...inner,
  async put(override) {
    const before = await inner.findByDate(override.resourceId, override.date);
    const after = await inner.put(override);
    await record(
      context,
      AUDIT_ACTIONS.dateOverrideChanged,
      "DateOverride",
      after.id,
      before,
      after,
    );
    return after;
  },
  async delete(id) {
    const removed = await inner.delete(id);
    await record(context, AUDIT_ACTIONS.dateOverrideChanged, "DateOverride", id, null, null);
    return removed;
  },
  /**
   * One row for the decision, not one per Override it took.
   *
   * The same reading as `replaceForResource` above: what a person did was
   * "the shop is shut from the first to the thirtieth", and ninety rows each
   * saying an Override was written is a worse record of that than one row
   * holding the closure and what it replaced. Kept against the Business, which
   * is whose days these are — an Override is not what was edited here, the
   * shop's calendar is.
   */
  async putMany(overrides) {
    if (overrides.length === 0) return [];
    const before = await priorOverrides(inner, overrides);
    const after = await inner.putMany(overrides);
    await record(
      context,
      AUDIT_ACTIONS.dateOverrideChanged,
      "Business",
      overrides[0]?.businessId ?? null,
      before,
      after,
    );
    return after;
  },
  async deleteBetween(resourceIds, from, to) {
    // The removed rows are the whole record: they are what was there, and
    // afterwards there is nothing to read.
    const removed = await inner.deleteBetween(resourceIds, from, to);
    if (removed.length === 0) return removed;
    await record(
      context,
      AUDIT_ACTIONS.dateOverrideChanged,
      "Business",
      removed[0]?.businessId ?? null,
      removed,
      null,
    );
    return removed;
  },
  async renameBetween(resourceIds, from, to, note) {
    const before = await inner.listForResources(resourceIds, from, to);
    const after = await inner.renameBetween(resourceIds, from, to, note);
    if (after.length === 0) return after;
    await record(
      context,
      AUDIT_ACTIONS.dateOverrideChanged,
      "Business",
      after[0]?.businessId ?? null,
      before,
      after,
    );
    return after;
  },
});

/**
 * What stood on these calendars and dates before the batch replaced it — one
 * read across the span rather than one per Override, which is the whole point.
 */
const priorOverrides = async (
  inner: DateOverrideRepository,
  overrides: readonly { resourceId: ResourceId; date: LocalDate }[],
) => {
  const dates = overrides.map((override) => override.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  /* istanbul ignore next -- both hold while there is an override, checked above */
  if (from === undefined || to === undefined) return [];
  const resourceIds = [...new Set(overrides.map((override) => override.resourceId))];
  return inner.listForResources(resourceIds, from, to);
};

export const auditedBlocks = (
  inner: BlockRepository,
  context: Context,
): BlockRepository => ({
  ...inner,
  async create(block) {
    const created = await inner.create(block);
    await record(context, AUDIT_ACTIONS.blockCreated, "Block", created.id, null, created);
    return created;
  },
  async delete(id) {
    await inner.delete(id);
    await record(context, AUDIT_ACTIONS.blockDeleted, "Block", id, null, null);
  },
});

/**
 * ADR 0006 makes "every write goes through a decorated repository" a standing
 * constraint, and a photo is a write like any other: what a business shows to
 * customers changed, and who changed it is worth being able to answer.
 */
export const auditedBusinessPhotos = (
  inner: BusinessPhotoRepository,
  context: Context,
): BusinessPhotoRepository => ({
  ...inner,
  async create(photo) {
    const created = await inner.create(photo);
    await record(
      context,
      AUDIT_ACTIONS.businessPhotoChanged,
      "BusinessPhoto",
      created.id,
      null,
      created,
    );
    return created;
  },
  async delete(id) {
    const before = await inner.findById(id);
    await inner.delete(id);
    await record(
      context,
      AUDIT_ACTIONS.businessPhotoRemoved,
      "BusinessPhoto",
      id,
      before,
      null,
    );
  },
});

export const auditedReviews = (
  inner: ReviewRepository,
  context: Context,
): ReviewRepository => ({
  ...inner,
  async put(review) {
    const before = await inner.findFor(review.businessId, review.customerId);
    const after = await inner.put(review);
    await record(
      context,
      before === null ? AUDIT_ACTIONS.reviewSubmitted : AUDIT_ACTIONS.reviewEdited,
      "Review",
      after.id,
      before,
      after,
    );
    return after;
  },
});

export const auditedUsers = (
  inner: UserRepository,
  context: Context,
): UserRepository => ({
  ...inner,
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.userUpdated, "User", id, before, after);
    return after;
  },
  async softDelete(id) {
    const before = await inner.findById(id);
    const after = await inner.softDelete(id);
    await record(context, AUDIT_ACTIONS.userDeleted, "User", id, before, after);
    return after;
  },
  async restore(id) {
    const after = await inner.restore(id);
    await record(context, AUDIT_ACTIONS.userRestored, "User", id, null, after);
    return after;
  },
  async anonymise(id) {
    const after = await inner.anonymise(id);
    // Neither `before` nor `after` carries the person's details. The trail
    // records that an erasure happened, by whom and to which row — recording
    // the values would keep exactly what the request asked to be removed.
    await record(context, AUDIT_ACTIONS.userAnonymised, "User", id, null, {
      anonymisedAt: after.anonymisedAt,
    });
    return after;
  },
  async acceptTerms(id, version) {
    const before = await inner.findById(id);
    const after = await inner.acceptTerms(id, version);
    await record(context, AUDIT_ACTIONS.termsAccepted, "User", id, before, after);
    return after;
  },
  async setAdministrator(id, isAdministrator) {
    const before = await inner.findById(id);
    const after = await inner.setAdministrator(id, isAdministrator);
    await record(
      context,
      isAdministrator
        ? AUDIT_ACTIONS.administratorGranted
        : AUDIT_ACTIONS.administratorRevoked,
      "User",
      id,
      before,
      after,
    );
    return after;
  },
});

export const auditedGrants = (inner: GrantRepository, context: Context): GrantRepository => ({
  ...inner,
  async create(grant) {
    const created = await inner.create(grant);
    await record(context, AUDIT_ACTIONS.grantGiven, "Grant", created.id, null, created);
    return created;
  },
  async update(id, changes) {
    const before = await inner.findById(id);
    const after = await inner.update(id, changes);
    await record(context, AUDIT_ACTIONS.grantChanged, "Grant", id, before, after);
    return after;
  },
});

export const auditedPlanVersions = (
  inner: PlanVersionRepository,
  context: Context,
): PlanVersionRepository => ({
  ...inner,
  async publish(edition) {
    const published = await inner.publish(edition);
    await record(context, AUDIT_ACTIONS.planEditionPublished, "PlanVersion", published.id, null, published);
    return published;
  },
  async setTerms(id, terms) {
    const before = await inner.findById(id);
    const after = await inner.setTerms(id, terms);
    await record(context, AUDIT_ACTIONS.planTermsImproved, "PlanVersion", id, before, after);
    return after;
  },
  async withdraw(id, at) {
    const before = await inner.findById(id);
    await inner.withdraw(id, at);
    await record(context, AUDIT_ACTIONS.planEditionWithdrawn, "PlanVersion", id, before, { withdrawnAt: at });
  },
});

export const auditedPreviews = (inner: PreviewRepository, context: Context): PreviewRepository => {
  const before = async (feature: string) =>
    (await inner.listEntries()).find((entry) => entry.feature === feature) ?? null;
  return {
    ...inner,
    async start(feature, endsOn) {
      const previous = await before(feature);
      const after = await inner.start(feature, endsOn);
      await record(context, AUDIT_ACTIONS.previewStarted, "Preview", feature, previous, after);
      return after;
    },
    async setEnd(feature, endsOn) {
      const previous = await before(feature);
      const after = await inner.setEnd(feature, endsOn);
      await record(context, AUDIT_ACTIONS.previewEndMoved, "Preview", feature, previous, after);
      return after;
    },
    async place(feature, placement, at) {
      const previous = await before(feature);
      const after = await inner.place(feature, placement, at);
      await record(context, AUDIT_ACTIONS.previewPlaced, "Preview", feature, previous, after);
      return after;
    },
  };
};

export const auditedUnitRates = (inner: UnitRateRepository, context: Context): UnitRateRepository => ({
  ...inner,
  async set(rate, checkedBy) {
    const before =
      (await inner.list()).find(
        (existing) => existing.unit === rate.unit && existing.effectiveFrom === rate.effectiveFrom,
      ) ?? null;
    const after = await inner.set(rate, checkedBy);
    await record(context, AUDIT_ACTIONS.unitRateSet, "UnitRate", `${rate.unit}:${rate.effectiveFrom}`, before, after);
    return after;
  },
});

export const auditedAddonOffers = (inner: AddonOfferRepository, context: Context): AddonOfferRepository => ({
  ...inner,
  async put(offer) {
    const before = (await inner.list()).find((existing) => existing.feature === offer.feature) ?? null;
    const after = await inner.put(offer);
    await record(context, AUDIT_ACTIONS.addonOfferChanged, "AddonOffer", offer.feature, before, after);
    return after;
  },
});

export const auditedAddonHoldings = (inner: AddonHoldingRepository, context: Context): AddonHoldingRepository => {
  const holdingOf = async (businessId: BusinessId, id: AddonHoldingId) =>
    (await inner.listForBusiness(businessId)).find((holding) => holding.id === id) ?? null;
  return {
    ...inner,
    async add(holding) {
      const added = await inner.add(holding);
      await record(context, AUDIT_ACTIONS.addonAdded, "AddonHolding", added.id, null, added);
      return added;
    },
    async addAsOwner(holding) {
      const added = await inner.addAsOwner(holding);
      await record(context, AUDIT_ACTIONS.addonAdded, "AddonHolding", added.id, null, added);
      return added;
    },
    async end(id, ending) {
      const after = await inner.end(id, ending);
      await record(context, AUDIT_ACTIONS.addonEnded, "AddonHolding", id, null, after);
      return after;
    },
    async endAsOwner(businessId, id, ending) {
      const before = await holdingOf(businessId, id);
      const after = await inner.endAsOwner(businessId, id, ending);
      await record(context, AUDIT_ACTIONS.addonEnded, "AddonHolding", id, before, after);
      return after;
    },
    async resume(id) {
      const after = await inner.resume(id);
      await record(context, AUDIT_ACTIONS.addonResumed, "AddonHolding", id, null, after);
      return after;
    },
    async resumeAsOwner(businessId, id) {
      const before = await holdingOf(businessId, id);
      const after = await inner.resumeAsOwner(businessId, id);
      await record(context, AUDIT_ACTIONS.addonResumed, "AddonHolding", id, before, after);
      return after;
    },
    async setPrices(changes) {
      await inner.setPrices(changes);
      for (const change of changes) {
        await record(context, AUDIT_ACTIONS.addonPricesSet, "AddonHolding", change.id, null, change);
      }
    },
  };
};

export const auditedDaysOwed = (inner: DaysOwedRepository, context: Context): DaysOwedRepository => ({
  ...inner,
  async add(owed) {
    const added = await inner.add(owed);
    await record(context, AUDIT_ACTIONS.daysOwedAdded, "DaysOwedEntry", added.id, null, added);
    return added;
  },
});

/** Applied where repositories are wired, which is the only place that knows. */
export const withAuditing = (
  repositories: Repositories,
  context: Context,
): Repositories => ({
  ...repositories,
  users: auditedUsers(repositories.users, context),
  businesses: auditedBusinesses(repositories.businesses, context),
  businessPhotos: auditedBusinessPhotos(repositories.businessPhotos, context),
  reviews: auditedReviews(repositories.reviews, context),
  memberships: auditedMemberships(repositories.memberships, context),
  membershipResources: auditedMembershipResources(repositories.membershipResources, context),
  resources: auditedResources(repositories.resources, context),
  services: auditedServices(repositories.services, context),
  workingHours: auditedWorkingHours(repositories.workingHours, context),
  dateOverrides: auditedDateOverrides(repositories.dateOverrides, context),
  blocks: auditedBlocks(repositories.blocks, context),
  appointments: auditedAppointments(repositories.appointments, context),
  subscriptions: auditedSubscriptions(repositories.subscriptions, context),
  grants: auditedGrants(repositories.grants, context),
  unitRates: auditedUnitRates(repositories.unitRates, context),
  planVersions: auditedPlanVersions(repositories.planVersions, context),
  previews: auditedPreviews(repositories.previews, context),
  addonOffers: auditedAddonOffers(repositories.addonOffers, context),
  addonHoldings: auditedAddonHoldings(repositories.addonHoldings, context),
  daysOwed: auditedDaysOwed(repositories.daysOwed, context),
  fairUseLimits: auditedFairUseLimits(repositories.fairUseLimits, context),
  referenceBusinesses: auditedReferenceBusinesses(repositories.referenceBusinesses, context),
  runningCosts: auditedRunningCosts(repositories.runningCosts, context),
});
