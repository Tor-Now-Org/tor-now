import {
  addAddon,
  cancelAddon,
  compareLocalDate,
  DomainError,
  FEATURES,
  isDomainError,
  isOnSale,
  nextPayment,
  notFound,
  priceOn,
  resumeAddon,
  todayIn,
  trialGives,
  upgradeDaysOwed,
  type AddonHolding,
  type BusinessId,
  type Clock,
  type DaysOwed,
  type Feature,
  type LocalDate,
  type Money,
  type MovedBy,
  type NextPayment,
  type Plan,
} from "@tor-now/domain";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { stillHeld, trialAddonsOf } from "./addons.ts";
import { loadOwnedBusiness, requireAdministrator } from "./authorization.ts";
import { subscriptionView } from "./billing.ts";
import { tell } from "./notices.ts";

/**
 * Add-ons as a Business holds them (ADR 0021): what is on sale to it, what it
 * holds, and what its next payment comes to — and adding, cancelling and
 * resuming one. The owner does it on their subscription page; an
 * administrator does the same for an owner who phones in, by the same rules
 * and with the same Notices.
 */

/** One Add-on as the subscription page shows it. */
export type AddonView = {
  readonly feature: Feature;
  /** What it costs each month: the hold's own price while held, else the sale's. */
  readonly price: Money;
  readonly onSale: boolean;
  /** The hold still giving it — running on, or cancelled until a day — if any. */
  readonly holding: AddonHolding | null;
  /** Held before and ended: adding it again owes the days until the next payment. */
  readonly hadBefore: boolean;
  /** The Trial's last day, while the Trial includes it. */
  readonly inTrialUntil: LocalDate | null;
  /** What adding it would do today; null when it cannot be added. */
  readonly ifAdded: { readonly paysFrom: LocalDate; readonly owed: DaysOwed | null } | null;
};

/** What a Business pays: its Add-ons, its next payment line by line, and what moving up would owe. */
export type PaymentBoard = {
  readonly addons: readonly AddonView[];
  readonly nextPayment: NextPayment;
  /** For each Plan it could move up to, the days that move would owe now — only a Plan it left before owes any. */
  readonly moveUpOwed: readonly { readonly plan: Plan; readonly owed: DaysOwed }[];
};

type Acting = {
  readonly businessId: BusinessId;
  readonly by: MovedBy;
  /** Whether writes go through the owner's own doors: a signed-in owner, not an administrator's connection. */
  readonly asOwner: boolean;
  readonly today: LocalDate;
};

/** The running Preview still giving this Business a Feature its Plan lacks, if any. */
const previewEndOf = async (repositories: Repositories, feature: Feature, today: LocalDate): Promise<LocalDate | null> => {
  const preview = (await repositories.previews.list()).find((candidate) => candidate.feature === feature);
  return preview === undefined || compareLocalDate(preview.endsOn, today) < 0 ? null : preview.endsOn;
};

/** Everything about what one Business pays, as of its own today. */
export const paymentBoard = async (repositories: Repositories, businessId: BusinessId, today: LocalDate): Promise<PaymentBoard> => {
  const [view, offers, holdings, daysOwed, previews, current, plansHeld] = await Promise.all([
    subscriptionView(repositories, businessId, today),
    repositories.addonOffers.list(),
    repositories.addonHoldings.listForBusiness(businessId),
    repositories.daysOwed.listOwed(businessId),
    repositories.previews.list(),
    repositories.planVersions.listCurrent(),
    repositories.subscriptions.plansHeld(businessId),
  ]);
  const { subscription, planVersion } = view;
  const planFeatures = planVersion.terms.features;
  const trial = trialAddonsOf(subscription.paidThrough === null ? subscription.trialEndsOn : null, offers);

  const shown = FEATURES.filter(
    (feature) =>
      !planFeatures.includes(feature) &&
      (offers.some((offer) => offer.feature === feature && isOnSale(offer)) ||
        holdings.some((holding) => holding.feature === feature && stillHeld(holding, today))),
  );

  const addons = shown.map((feature): AddonView => {
    const offer = offers.find((candidate) => candidate.feature === feature) ?? null;
    const history = holdings.filter((holding) => holding.feature === feature);
    const holding = history.find((candidate) => stillHeld(candidate, today)) ?? null;
    const preview = previews.find((candidate) => candidate.feature === feature && compareLocalDate(candidate.endsOn, today) >= 0);
    // Shown only while on sale or still held, so one of the two prices is there.
    const price = holding === null ? offer?.price : priceOn(holding, today);
    if (price === undefined) throw notFound("AddonOffer", feature);
    const ifAdded = (() => {
      if (holding !== null) return null;
      try {
        const added = addAddon({
          offer,
          history,
          planFeatures,
          subscription,
          previewEndsOn: preview?.endsOn ?? null,
          today,
        });
        return added.kind === "NEW" ? { paysFrom: added.paysFrom, owed: added.owed } : null;
      } catch (error) {
        if (isDomainError(error)) return null;
        throw error;
      }
    })();
    return {
      feature,
      price,
      onSale: offer !== null && isOnSale(offer),
      holding,
      hadBefore: history.some((candidate) => !stillHeld(candidate, today)),
      inTrialUntil: trial !== null && trialGives(trial, feature, today) ? trial.endsOn : null,
      ifAdded,
    };
  });

  return {
    addons,
    nextPayment: nextPayment({
      subscription,
      planVersion,
      scheduledVersion: view.scheduledVersion,
      holdings,
      daysOwed,
      today,
    }),
    moveUpOwed: current.flatMap((to) => {
      const owed = upgradeDaysOwed({ from: planVersion, to, subscription, plansHeld, today });
      return owed === null ? [] : [{ plan: to.plan, owed }];
    }),
  };
};

/**
 * Adding one: the first time, it is paid from the next payment; having had it
 * before, the days until then are owed too. A cancellation not yet landed is
 * simply withdrawn.
 */
const add = async (repositories: Repositories, acting: Acting, feature: Feature, now: Clock["now"]): Promise<void> => {
  const { businessId, today } = acting;
  const [view, offers, holdings] = await Promise.all([
    subscriptionView(repositories, businessId, today),
    repositories.addonOffers.list(),
    repositories.addonHoldings.listForBusiness(businessId),
  ]);
  const result = addAddon({
    offer: offers.find((candidate) => candidate.feature === feature) ?? null,
    history: holdings.filter((holding) => holding.feature === feature),
    planFeatures: view.planVersion.terms.features,
    subscription: view.subscription,
    previewEndsOn: await previewEndOf(repositories, feature, today),
    today,
  });

  if (result.kind === "RESUME") {
    resumeAddon({ holding: result.holding, today });
    if (acting.asOwner) await repositories.addonHoldings.resumeAsOwner(businessId, result.holding.id);
    else await repositories.addonHoldings.resume(result.holding.id);
    return;
  }

  const holding = { businessId, feature, addedOn: today, paysFrom: result.paysFrom, price: result.price };
  if (acting.asOwner) await repositories.addonHoldings.addAsOwner(holding);
  else await repositories.addonHoldings.add(holding);
  if (result.owed !== null) {
    await repositories.daysOwed.add({ businessId, kind: "ADDON_DAYS", subject: feature, ...result.owed });
  }
  await tell(repositories, {
    businessId,
    facts: {
      kind: "ADDON_ADDED",
      feature,
      by: acting.by,
      priceMinor: result.price,
      paysFrom: result.paysFrom,
      owedMinor: result.owed?.amount ?? 0,
    },
    at: now(),
  });
};

/** Cancelling one: it runs to the end of what is paid for, then stops. */
const cancel = async (repositories: Repositories, acting: Acting, feature: Feature, now: Clock["now"]): Promise<void> => {
  const { businessId, today } = acting;
  const [view, holdings] = await Promise.all([
    subscriptionView(repositories, businessId, today),
    repositories.addonHoldings.listForBusiness(businessId),
  ]);
  const holding = holdings.find((candidate) => candidate.feature === feature && candidate.ending === null);
  if (holding === undefined) throw new DomainError("CONFLICT", "This Add-on is not held");
  const { endsOn } = cancelAddon({ holding, subscription: view.subscription, today });
  const ending = { endsOn, ending: "CANCELLED" as const };
  if (acting.asOwner) await repositories.addonHoldings.endAsOwner(businessId, holding.id, ending);
  else await repositories.addonHoldings.end(holding.id, ending);
  await tell(repositories, { businessId, facts: { kind: "ADDON_CANCELLED", feature, by: acting.by, endsOn }, at: now() });
};

export const addonService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  const now = () => clock.now();

  /** The owner's own Business, as the owner acts on it. */
  const asOwner = (actor: Actor, businessId: BusinessId, work: (repositories: Repositories, acting: Acting) => Promise<void>) =>
    unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      const today = todayIn(clock.now(), business.timeZone);
      await work(repositories, { businessId, by: "OWNER", asOwner: actor.kind === "USER", today });
      return paymentBoard(repositories, businessId, today);
    });

  /** Any Business, as an administrator acts for its owner. */
  const forOwner = async (actor: Actor, businessId: BusinessId, work: (repositories: Repositories, acting: Acting) => Promise<void>) => {
    requireAdministrator(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);
      const today = todayIn(clock.now(), business.timeZone);
      await work(repositories, { businessId, by: "ADMINISTRATOR", asOwner: false, today });
      return paymentBoard(repositories, businessId, today);
    });
  };

  return {
    mine: (actor: Actor, businessId: BusinessId) => asOwner(actor, businessId, async () => {}),
    addMine: (actor: Actor, businessId: BusinessId, feature: Feature) =>
      asOwner(actor, businessId, (repositories, acting) => add(repositories, acting, feature, now)),
    cancelMine: (actor: Actor, businessId: BusinessId, feature: Feature) =>
      asOwner(actor, businessId, (repositories, acting) => cancel(repositories, acting, feature, now)),

    of: (actor: Actor, businessId: BusinessId) => forOwner(actor, businessId, async () => {}),
    addFor: (actor: Actor, businessId: BusinessId, feature: Feature) =>
      forOwner(actor, businessId, (repositories, acting) => add(repositories, acting, feature, now)),
    cancelFor: (actor: Actor, businessId: BusinessId, feature: Feature) =>
      forOwner(actor, businessId, (repositories, acting) => cancel(repositories, acting, feature, now)),
  };
};
