import type { AddonHoldingId, BusinessId } from "../model/ids.ts";
import { money, type Money } from "../model/money.ts";
import { DomainError, validationFailed } from "../shared/errors.ts";
import { addDays, compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { daysOwed, type DaysOwed } from "./days-owed.ts";
import type { Feature } from "./feature.ts";
import type { PlanVersion } from "./plan.ts";
import { BILLING_PERIOD_DAYS, moveTakesEffectOn, renewalOn, type Subscription } from "./subscription.ts";

/**
 * Add-ons (ADR 0021): a Feature sold on its own, at one flat monthly price, on
 * top of any Plan — never more than two on sale at once.
 *
 * What an owner adds is free until their next payment only the first time.
 * Adding one back, having had it before, is paid from that day: otherwise
 * adding, cancelling and adding again would never pay for a single day.
 */

export const MAX_ADDONS_ON_SALE = 2;

/**
 * A rise waiting to reach those who hold the Add-on: each at their first
 * renewal thirty days on, the first on `firstOn` and the last on `lastOn`.
 * Cancellable until `firstOn`, as a Plan's pending edition is (ADR 0020).
 */
export type AddonRise = {
  readonly from: Money;
  readonly announcedOn: LocalDate;
  readonly firstOn: LocalDate;
  readonly lastOn: LocalDate;
};

/** A Feature on sale on its own, as the Catalogue sells it. */
export type AddonOffer = {
  readonly feature: Feature;
  /** What a new buyer pays each month. */
  readonly price: Money;
  readonly since: LocalDate;
  /** Nobody new adds it from this day; those holding it keep it. Null while on sale. */
  readonly stoppedOn: LocalDate | null;
  readonly rise: AddonRise | null;
};

export type AddonEnding = "CANCELLED" | "INCLUDED";

/** One Business's hold of one Add-on. Kept after it ends: it says the Business had it. */
export type AddonHolding = {
  readonly id: AddonHoldingId;
  readonly businessId: BusinessId;
  readonly feature: Feature;
  readonly addedOn: LocalDate;
  /** The first renewal it is paid at. */
  readonly paysFrom: LocalDate;
  /** What it costs each month now. */
  readonly price: Money;
  /** A rise on its way to this holder. */
  readonly nextPrice: { readonly price: Money; readonly effectiveOn: LocalDate } | null;
  /** Its last day, once it is ending; null while it runs on. */
  readonly endsOn: LocalDate | null;
  readonly ending: AddonEnding | null;
};

type Cover = Pick<Subscription, "trialEndsOn" | "paidThrough">;

const before = (left: LocalDate, right: LocalDate): boolean => compareLocalDate(left, right) < 0;

export const isOnSale = (offer: AddonOffer): boolean => offer.stoppedOn === null;

/** Whether the Add-on gives its Feature on a day. */
export const runsOn = (holding: Pick<AddonHolding, "addedOn" | "endsOn">, day: LocalDate): boolean =>
  !before(day, holding.addedOn) && (holding.endsOn === null || !before(holding.endsOn, day));

/** What the holder pays for a month that starts on a day. */
export const priceOn = (holding: Pick<AddonHolding, "price" | "nextPrice">, day: LocalDate): Money =>
  holding.nextPrice !== null && !before(day, holding.nextPrice.effectiveOn) ? holding.nextPrice.price : holding.price;

const requirePrice = (price: number): Money => {
  if (!Number.isInteger(price) || price <= 0) throw validationFailed("An Add-on's price is a positive amount", { field: "price" });
  return money(price);
};

/**
 * Whether a Feature can go on sale on its own: some Plan lacks it, it is not
 * already sold, and fewer than two are. A Feature in Preview goes on sale only
 * as the Preview's end is decided — before that, everyone has it anyway.
 */
export const checkAddonSale = (input: {
  feature: Feature;
  price: number;
  offers: readonly AddonOffer[];
  /** The current edition of every Plan. */
  editions: readonly PlanVersion[];
  /** Features in a Preview still running. */
  previewing: readonly Feature[];
  /** The Preview's own end being decided. */
  placing?: boolean;
  today: LocalDate;
}): Money => {
  const price = requirePrice(input.price);
  if (input.editions.every((edition) => edition.terms.features.includes(input.feature))) {
    throw validationFailed("Every plan includes this Feature", { field: "feature" });
  }
  if (input.previewing.includes(input.feature) && input.placing !== true) {
    throw validationFailed("A Feature in Preview is sold when its end is decided", { field: "feature" });
  }
  const onSale = input.offers.filter(isOnSale);
  if (onSale.some((offer) => offer.feature === input.feature)) {
    throw validationFailed("This Add-on is already on sale", { field: "feature" });
  }
  if (onSale.length >= MAX_ADDONS_ON_SALE) {
    throw validationFailed("No more than two Add-ons are on sale at once", { field: "feature", max: MAX_ADDONS_ON_SALE });
  }
  return price;
};

/** The first renewal on or after a day. */
const renewalFrom = (cover: Cover, day: LocalDate, today: LocalDate): LocalDate => {
  const first = renewalOn(cover) ?? today;
  let renewal = first;
  while (before(renewal, day)) renewal = addDays(renewal, BILLING_PERIOD_DAYS);
  return renewal;
};

export type AddonAdd =
  /** A cancellation not yet landed, withdrawn: the Add-on simply runs on. */
  | { readonly kind: "RESUME"; readonly holding: AddonHolding }
  | {
      readonly kind: "NEW";
      readonly price: Money;
      readonly paysFrom: LocalDate;
      /** The days owed before `paysFrom`, when the Business had it before. */
      readonly owed: DaysOwed | null;
    };

/**
 * An owner adding an Add-on. The first time, it is theirs at once and paid
 * from the next payment. Having had it before, the days until then are owed
 * too. Paid time is what decides — a Trial is free anyway, and a Preview still
 * giving the Feature is not charged for until it ends.
 */
export const addAddon = (input: {
  offer: AddonOffer | null;
  /** Every hold this Business ever had of this Add-on. */
  history: readonly AddonHolding[];
  planFeatures: readonly Feature[];
  subscription: Cover;
  /** The end of a Preview still giving the Feature, if one is. */
  previewEndsOn: LocalDate | null;
  today: LocalDate;
}): AddonAdd => {
  const { offer, history, today } = input;
  const running = history.filter((holding) => runsOn(holding, today) || before(today, holding.addedOn));
  const cancelled = running.find((holding) => holding.ending === "CANCELLED");
  if (cancelled !== undefined) return { kind: "RESUME", holding: cancelled };
  if (running.length > 0) throw new DomainError("CONFLICT", "This Add-on is already held");
  if (offer === null || !isOnSale(offer)) throw validationFailed("This Add-on is not on sale", { field: "feature" });
  if (input.planFeatures.includes(offer.feature)) {
    throw validationFailed("The plan already includes this Feature", { field: "feature" });
  }
  const paysFrom =
    input.previewEndsOn === null
      ? renewalFrom(input.subscription, renewalOn(input.subscription) ?? today, today)
      : renewalFrom(input.subscription, addDays(input.previewEndsOn, 1), today);
  const { paidThrough } = input.subscription;
  const owed =
    history.length > 0 && paidThrough !== null && input.previewEndsOn === null
      ? daysOwed(offer.price, today, paidThrough)
      : null;
  return { kind: "NEW", price: offer.price, paysFrom, owed };
};

/** Cancelling: it runs to the end of what is covered — at once when nothing is. */
export const cancelAddon = (input: { holding: AddonHolding; subscription: Cover; today: LocalDate }): { readonly endsOn: LocalDate } => {
  const { holding, today } = input;
  if (holding.ending !== null) throw new DomainError("CONFLICT", "This Add-on is cancelled already");
  const covered = input.subscription.paidThrough ?? input.subscription.trialEndsOn;
  return { endsOn: covered !== null && !before(covered, today) ? covered : addDays(today, -1) };
};

/** Withdrawing a cancellation, while the Add-on still runs. */
export const resumeAddon = (input: { holding: AddonHolding; today: LocalDate }): void => {
  const { holding, today } = input;
  if (holding.ending !== "CANCELLED") throw new DomainError("CONFLICT", "This Add-on is not cancelled");
  if (holding.endsOn === null || before(holding.endsOn, today)) throw new DomainError("CONFLICT", "This Add-on has ended");
};

/** An Add-on the Plan now gives: it ends, and is paid for no longer. */
export const endIncluded = (today: LocalDate): { readonly endsOn: LocalDate; readonly ending: AddonEnding } => ({
  endsOn: addDays(today, -1),
  ending: "INCLUDED",
});

const risePending = (offer: AddonOffer, today: LocalDate): boolean => offer.rise !== null && before(today, offer.rise.lastOn);

/** A new price for an Add-on on sale. A second rise waits until the first has reached everyone. */
export const checkPriceChange = (input: { offer: AddonOffer; to: number; today: LocalDate }): Money => {
  const { offer } = input;
  const to = requirePrice(input.to);
  if (!isOnSale(offer)) throw validationFailed("This Add-on is no longer on sale", { field: "feature" });
  if (to === offer.price) throw validationFailed("The price is the same", { field: "price" });
  if (to > offer.price && risePending(offer, input.today)) {
    throw new DomainError("CONFLICT", "A rise is still on its way to those who hold this Add-on");
  }
  return to;
};

/**
 * A rise: new buyers pay it at once; each holder from their first renewal at
 * least thirty days on, told now (ADR 0020). A holder whose Add-on ends before
 * then never pays it.
 */
export const priceRise = (input: {
  offer: AddonOffer;
  to: Money;
  holdings: readonly AddonHolding[];
  subscriptions: ReadonlyMap<BusinessId, Cover>;
  today: LocalDate;
}): {
  readonly offer: AddonOffer;
  readonly holdings: readonly { readonly id: AddonHoldingId; readonly nextPrice: NonNullable<AddonHolding["nextPrice"]> }[];
} => {
  const { offer, to, today } = input;
  const holdings = input.holdings.flatMap((holding) => {
    const subscription = input.subscriptions.get(holding.businessId);
    if (subscription === undefined) return [];
    const effectiveOn = moveTakesEffectOn(subscription, today);
    if (holding.endsOn !== null && before(holding.endsOn, effectiveOn)) return [];
    return [{ id: holding.id, nextPrice: { price: to, effectiveOn } }];
  });
  const days = holdings.map((holding) => holding.nextPrice.effectiveOn).sort();
  const firstOn = days[0];
  const lastOn = days[days.length - 1];
  return {
    offer: {
      ...offer,
      price: to,
      rise: firstOn === undefined || lastOn === undefined ? null : { from: offer.price, announcedOn: today, firstOn, lastOn },
    },
    holdings,
  };
};

/** A rise withdrawn before it reached anyone: the old price, for new buyers too. */
export const riseCancelled = (input: { offer: AddonOffer; today: LocalDate }): AddonOffer => {
  const { rise } = input.offer;
  if (rise === null || !before(input.today, rise.lastOn)) throw new DomainError("CONFLICT", "No rise is on its way");
  if (!before(input.today, rise.firstOn)) {
    throw new DomainError("CONFLICT", "The rise has reached those who hold it; it moved already");
  }
  return { ...input.offer, price: rise.from, rise: null };
};

/**
 * A lower price gives, so it applies to everyone at once — including a rise
 * still on its way, which it caps, or undoes when it goes below where the rise
 * started.
 */
export const priceDrop = (input: {
  offer: AddonOffer;
  to: Money;
  holdings: readonly AddonHolding[];
}): {
  readonly offer: AddonOffer;
  readonly holdings: readonly { readonly id: AddonHoldingId; readonly price: Money; readonly nextPrice: AddonHolding["nextPrice"] }[];
} => {
  const { offer, to } = input;
  const capped = (price: Money): Money => (price < to ? price : to);
  return {
    offer: { ...offer, price: to, rise: offer.rise !== null && offer.rise.from < to ? offer.rise : null },
    holdings: input.holdings.map((holding) => {
      const price = capped(holding.price);
      const next = holding.nextPrice === null ? null : capped(holding.nextPrice.price);
      return {
        id: holding.id,
        price,
        nextPrice: holding.nextPrice === null || next === null || next <= price ? null : { ...holding.nextPrice, price: next },
      };
    }),
  };
};
