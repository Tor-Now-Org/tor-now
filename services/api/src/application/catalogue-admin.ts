import {
  checkExtension,
  checkGrants,
  checkUnitRate,
  compareLocalDate,
  endedGrantEndsOn,
  featureSources,
  notFound,
  todayIn,
  timeZone,
  validationFailed,
  type BusinessId,
  type Clock,
  type CostUnit,
  type Feature,
  type FeatureSource,
  type GrantId,
  type LocalDate,
  type MicroShekels,
} from "@tor-now/domain";
import type { GrantEntry, Repositories, UnitRateEntry } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireAdministrator } from "./authorization.ts";
import { trialAddonsOf } from "./addons.ts";
import { subscriptionView } from "./billing.ts";
import { tell } from "./notices.ts";

/**
 * The Catalogue editor's first part (ADR 0021): the Unit Rates behind every
 * Usage Record's cost, and Grants — a Feature given to one Business, for a
 * reason, until a day. Every write is audited by the repositories' decorator.
 */

/** Every Feature of a Business and where it comes from, with each Grant's details. */
export const featuresWithGrants = async (
  repositories: Repositories,
  businessId: BusinessId,
  today: LocalDate,
): Promise<readonly FeatureSource<GrantEntry>[]> => {
  const [view, grants, previews, addons, offers] = await Promise.all([
    subscriptionView(repositories, businessId, today),
    repositories.grants.listForBusiness(businessId),
    repositories.previews.list(),
    repositories.addonHoldings.listForBusiness(businessId),
    repositories.addonOffers.list(),
  ]);
  const { paidThrough, trialEndsOn } = view.subscription;
  return featureSources({
    terms: view.planVersion.terms,
    grants,
    previews,
    addons,
    trialAddons: trialAddonsOf(paidThrough === null ? trialEndsOn : null, offers),
    today,
  });
};

const businessToday = async (repositories: Repositories, businessId: BusinessId, clock: Clock) => {
  const business = await repositories.businesses.findById(businessId);
  if (business === null) throw notFound("Business", businessId);
  return todayIn(clock.now(), business.timeZone);
};

/** The Grant, if it is this Business's. */
const grantOf = async (repositories: Repositories, businessId: BusinessId, grantId: GrantId) => {
  const grant = await repositories.grants.findById(grantId);
  if (grant === null || grant.businessId !== businessId) throw notFound("Grant", grantId);
  return grant;
};

export const catalogueAdminService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => ({
  async rates(actor: Actor): Promise<readonly UnitRateEntry[]> {
    requireAdministrator(actor);
    return unitOfWork.run(actor, ({ repositories }) => repositories.unitRates.list());
  },

  /**
   * A figure for a unit from a day — a correction when the day is past, and
   * everything used since is priced again when it is next read (ADR 0022).
   */
  async setRate(
    actor: Actor,
    input: { unit: CostUnit; effectiveFrom: LocalDate; perUnit: MicroShekels; source: string },
  ): Promise<readonly UnitRateEntry[]> {
    const administratorId = requireAdministrator(actor);
    // Rates are the platform's, not a Business's, so its own day is Israel's.
    const rate = checkUnitRate(input, todayIn(clock.now(), timeZone("Asia/Jerusalem")));
    return unitOfWork.run(actor, async ({ repositories }) => {
      await repositories.unitRates.set(rate, administratorId);
      return repositories.unitRates.list();
    });
  },

  async features(actor: Actor, businessId: BusinessId) {
    requireAdministrator(actor);
    return unitOfWork.run(actor, async ({ repositories }) =>
      featuresWithGrants(repositories, businessId, await businessToday(repositories, businessId, clock)),
    );
  },

  /** Several Features at once: each its own Grant, one Notice for them all. */
  async grantFeatures(
    actor: Actor,
    businessId: BusinessId,
    input: { features: readonly Feature[]; endsOn: LocalDate; reason: string },
  ) {
    const administratorId = requireAdministrator(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const today = await businessToday(repositories, businessId, clock);
      const checked = checkGrants({
        ...input,
        sources: await featuresWithGrants(repositories, businessId, today),
        today,
      });
      for (const feature of checked.features) {
        await repositories.grants.create({
          businessId,
          feature,
          reason: checked.reason,
          endsOn: input.endsOn,
          grantedBy: administratorId,
        });
      }
      await tell(repositories, {
        businessId,
        facts: { kind: "FEATURES_GRANTED", features: checked.features, endsOn: input.endsOn },
        at: clock.now(),
      });
      return featuresWithGrants(repositories, businessId, today);
    });
  },

  async extendGrant(
    actor: Actor,
    businessId: BusinessId,
    grantId: GrantId,
    input: { endsOn: LocalDate; reason: string },
  ) {
    requireAdministrator(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const today = await businessToday(repositories, businessId, clock);
      const grant = await grantOf(repositories, businessId, grantId);
      const reason = checkExtension({ grant, endsOn: input.endsOn, reason: input.reason, today });
      await repositories.grants.update(grantId, { endsOn: input.endsOn, reason });
      await tell(repositories, {
        businessId,
        facts: { kind: "GRANT_EXTENDED", feature: grant.feature, endsOn: input.endsOn },
        at: clock.now(),
      });
      return featuresWithGrants(repositories, businessId, today);
    });
  },

  /**
   * Ends a Grant today. What was made with the Feature stays; only new use
   * stops, as everywhere a Feature is lost (ADR 0019).
   */
  async endGrant(actor: Actor, businessId: BusinessId, grantId: GrantId) {
    requireAdministrator(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const today = await businessToday(repositories, businessId, clock);
      const grant = await grantOf(repositories, businessId, grantId);
      if (compareLocalDate(grant.endsOn, today) < 0) {
        throw validationFailed("Only a running Grant can be ended", { field: "grant" });
      }
      await repositories.grants.update(grantId, { endsOn: endedGrantEndsOn(today), reason: grant.reason });
      await tell(repositories, {
        businessId,
        facts: { kind: "GRANT_ENDED", feature: grant.feature },
        at: clock.now(),
      });
      return featuresWithGrants(repositories, businessId, today);
    });
  },
});
