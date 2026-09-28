import {
  asId,
  backFromEdition,
  classifyChange,
  compareLocalDate,
  DomainError,
  extendTerms,
  moveToEdition,
  notFound,
  planTerms,
  timeZone,
  todayIn,
  validationFailed,
  money,
  type BusinessId,
  type Clock,
  type Feature,
  type LocalDate,
  type Plan,
  type PlanTerms,
  type PlanVersionId,
  type Preview,
  type Subscription,
} from "@tor-now/domain";
import type { DirectoryEntry, PlanEdition, Repositories } from "../ports/repositories.ts";
import type { Actor, Session, UnitOfWork } from "../ports/unit-of-work.ts";
import { endIncludedAddons, stopSaleOnceEveryPlanHas } from "./addons.ts";
import { resumeWithinAllowance } from "./allowance.ts";
import { requireAdministrator } from "./authorization.ts";
import { entitlementOf } from "./billing.ts";
import { announce, tell } from "./notices.ts";

/**
 * Editing Plans (ADR 0020, ADR 0021): what gives value applies to every edition
 * of the Plan at once; what takes any becomes a new edition, which new
 * Businesses join at once and existing ones move to at their first renewal
 * after thirty days' Notice. While nobody has moved yet it can be cancelled,
 * and then it is as if it never was.
 */

/** The Catalogue is the platform's, so its day is Israel's. */
const PLATFORM_ZONE = timeZone("Asia/Jerusalem");

/** One edition, and how many Businesses are on it or on their way. */
export type EditionView = {
  readonly edition: PlanEdition;
  readonly current: boolean;
  readonly businesses: number;
};

/** A new edition waiting for existing Businesses to move onto it. */
export type PendingChange = {
  readonly edition: PlanEdition;
  readonly previous: PlanEdition;
  /** Existing Businesses due to move, each on its own day. */
  readonly moving: readonly { readonly business: DirectoryEntry["business"]; readonly effectiveOn: LocalDate }[];
  /** Businesses already on it: new ones, and owners who chose the Plan since. */
  readonly joined: readonly DirectoryEntry["business"][];
  readonly cancellable: boolean;
};

export type PlanView = {
  readonly plan: Plan;
  readonly current: PlanEdition;
  /** Every edition anybody is on, and the current one, newest first. */
  readonly editions: readonly EditionView[];
  readonly pending: PendingChange | null;
  /** When existing Businesses would move, were a change that takes value published today. */
  readonly ifTakenToday: { readonly firstMoveOn: LocalDate; readonly lastMoveOn: LocalDate; readonly businesses: number } | null;
};

type Catalogue = {
  readonly editions: readonly PlanEdition[];
  readonly entries: readonly DirectoryEntry[];
  readonly previews: readonly Preview[];
};

const read = async (repositories: Repositories): Promise<Catalogue> => {
  const [editions, entries, previews] = await Promise.all([
    repositories.planVersions.listEditions(),
    repositories.subscriptions.directory(),
    repositories.previews.list(),
  ]);
  return { editions, entries, previews };
};

const planOfIn = (editions: readonly PlanEdition[]) => {
  const byId = new Map(editions.map((edition) => [edition.id, edition.plan]));
  return (id: PlanVersionId): Plan | null => byId.get(id) ?? null;
};

const standing = (editions: readonly PlanEdition[], plan: Plan) =>
  editions.filter((edition) => edition.plan === plan && edition.withdrawnAt === null).sort((a, b) => b.number - a.number);

/** Stands for the edition about to be published, while working out who would move. */
const NOT_YET_PUBLISHED = asId<"PlanVersion">("not-yet-published");

const conflict = (message: string) => new DomainError("CONFLICT", message);

/** Earliest and latest of a list of days. */
const span = (days: readonly LocalDate[]) => {
  const sorted = [...days].sort(compareLocalDate);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first === undefined || last === undefined ? null : { first, last };
};

const viewOf = (catalogue: Catalogue, plan: Plan, today: LocalDate, todayOf: (entry: DirectoryEntry) => LocalDate): PlanView => {
  const { editions, entries } = catalogue;
  const planOf = planOfIn(editions);
  const [current, previous] = standing(editions, plan);
  if (current === undefined) throw notFound("PlanVersion", plan);
  const on = (id: PlanVersionId) => entries.filter((entry) => entry.subscription.planVersionId === id);

  const movingTo = entries.flatMap((entry) => {
    const move = entry.subscription.scheduledMove;
    return move !== null && move.planVersionId === current.id && planOf(entry.subscription.planVersionId) === plan
      ? [{ business: entry.business, effectiveOn: move.effectiveOn }]
      : [];
  });
  const pending: PendingChange | null =
    previous !== undefined && current.firstMoveOn !== null && movingTo.length > 0
      ? {
          edition: current,
          previous,
          moving: movingTo,
          joined: on(current.id).map((entry) => entry.business),
          cancellable: compareLocalDate(today, current.firstMoveOn) < 0,
        }
      : null;

  const would = entries.flatMap((entry) => {
    const moved = moveToEdition(entry.subscription, {
      plan,
      editionId: NOT_YET_PUBLISHED,
      planOf,
      noticedOn: todayOf(entry),
    });
    return moved?.scheduledMove === null || moved === null ? [] : [moved.scheduledMove.effectiveOn];
  });
  const window = span(would);

  return {
    plan,
    current,
    editions: editions
      .filter((edition) => edition.plan === plan && edition.withdrawnAt === null)
      .map((edition) => ({ edition, current: edition.id === current.id, businesses: on(edition.id).length }))
      .filter((view) => view.current || view.businesses > 0)
      .sort((a, b) => b.edition.number - a.edition.number),
    pending,
    ifTakenToday: window === null ? null : { firstMoveOn: window.first, lastMoveOn: window.last, businesses: would.length },
  };
};

export type PlanChangeInput = { readonly priceMinor: number; readonly resourceAllowance: number; readonly features: readonly Feature[] };

/**
 * Changing a Plan's terms, by the one rule whichever screen asks: the Plan's
 * own editor, or a Feature's "which plans" (ADR 0021). Classified here, not by
 * the caller — what the screen said it would do is what the rules decide.
 */
export const planChanger = (clock: Clock) => {
  const today = () => todayIn(clock.now(), PLATFORM_ZONE);
  const todayOf = (entry: DirectoryEntry) => todayIn(clock.now(), entry.business.timeZone);
  const views = (catalogue: Catalogue) =>
    (["SOLO", "TEAM"] as const).map((plan) => viewOf(catalogue, plan, today(), todayOf));

  /** What a change that only gives does: onto every edition, told to everyone on the Plan. */
  const give = async (session: Session, catalogue: Catalogue, plan: Plan, change: ReturnType<typeof classifyChange>["change"]) => {
    const { repositories } = session;
    const editions = standing(catalogue.editions, plan);
    const current = editions[0];
    if (current === undefined) throw notFound("PlanVersion", plan);
    for (const edition of editions) {
      await repositories.planVersions.setTerms(edition.id, extendTerms(edition.terms, change));
    }
    const ids = new Set(editions.map((edition) => edition.id));
    for (const entry of catalogue.entries.filter((candidate) => ids.has(candidate.subscription.planVersionId))) {
      const businessId = entry.business.id;
      if (change.allowance !== null) {
        await resumeWithinAllowance(repositories, businessId, await entitlementOf(repositories, businessId, todayOf(entry)), clock.now());
      }
      // What was an Add-on is the Plan's now: it stops costing anything extra.
      await endIncludedAddons(repositories, {
        businessId,
        plan,
        features: change.featuresAdded,
        asOwner: false,
        today: todayOf(entry),
        at: clock.now(),
      });
      await tell(repositories, {
        businessId,
        facts: {
          kind: "PLAN_IMPROVED",
          plan,
          priceFrom: change.price?.from ?? current.terms.price,
          priceTo: change.price?.to ?? current.terms.price,
          allowanceFrom: change.allowance?.from ?? current.terms.resourceAllowance,
          allowanceTo: change.allowance?.to ?? current.terms.resourceAllowance,
          gained: change.featuresAdded,
        },
        at: clock.now(),
      });
    }
    for (const feature of change.featuresAdded) await stopSaleOnceEveryPlanHas(repositories, feature, today());
  };

  /** What a change that takes does: a new edition, and every existing Business told when it moves. */
  const take = async (session: Session, catalogue: Catalogue, plan: Plan, terms: ReturnType<typeof planTerms>) => {
    const { repositories } = session;
    const view = viewOf(catalogue, plan, today(), todayOf);
    if (view.pending !== null) throw conflict(`A change to ${plan} is still waiting for Businesses to move`);
    const planOf = planOfIn(catalogue.editions);
    const number = Math.max(...catalogue.editions.filter((e) => e.plan === plan).map((e) => e.number)) + 1;
    const moves = catalogue.entries.flatMap((entry) => {
      const moved = moveToEdition(entry.subscription, { plan, editionId: NOT_YET_PUBLISHED, planOf, noticedOn: todayOf(entry) });
      return moved === null || moved.scheduledMove === null ? [] : [{ entry, effectiveOn: moved.scheduledMove.effectiveOn }];
    });
    const window = span(moves.map((move) => move.effectiveOn));
    const edition = await repositories.planVersions.publish({ plan, number, terms, firstMoveOn: window?.first ?? null });
    const change = classifyChange(view.current.terms, terms).change;
    for (const { entry, effectiveOn } of moves) {
      await repositories.subscriptions.update(entry.business.id, {
        scheduledMove: { planVersionId: edition.id, effectiveOn },
      });
      await announce(session, {
        businessId: entry.business.id,
        facts: {
          kind: "EDITION_ANNOUNCED",
          plan,
          effectiveOn,
          priceFrom: view.current.terms.price,
          priceTo: terms.price,
          allowanceFrom: view.current.terms.resourceAllowance,
          allowanceTo: terms.resourceAllowance,
          gained: change.featuresAdded,
          lost: change.featuresRemoved,
        },
        at: clock.now(),
      });
    }
  };

  /** A Plan's new terms, applied: onto every edition when they only give, as a new edition when they take. */
  const apply = async (session: Session, plan: Plan, terms: PlanTerms): Promise<"GIVES" | "TAKES"> => {
    const catalogue = await read(session.repositories);
    const inPreview = catalogue.previews
      .filter((preview) => compareLocalDate(today(), preview.endsOn) <= 0)
      .map((preview) => preview.feature)
      .filter((feature) => terms.features.includes(feature));
    if (inPreview.length > 0) {
      throw validationFailed("A Feature in Preview is placed when the Preview ends", { features: inPreview });
    }
    const current = standing(catalogue.editions, plan)[0];
    if (current === undefined) throw notFound("PlanVersion", plan);
    const { kind, change } = classifyChange(current.terms, terms);
    if (kind === "NONE") throw validationFailed("Nothing about the plan changed");
    if (kind === "GIVES") await give(session, catalogue, plan, change);
    else await take(session, catalogue, plan, terms);
    return kind;
  };

  return { apply, views, today, todayOf };
};

export const planCatalogueService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  const { apply, views, today, todayOf } = planChanger(clock);

  return {
    async plans(actor: Actor) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const catalogue = await read(repositories);
        return { plans: views(catalogue), previews: catalogue.previews };
      });
    },

    /** A Plan's new price, calendars and Features. */
    async changePlan(actor: Actor, plan: Plan, input: PlanChangeInput) {
      requireAdministrator(actor);
      const terms = planTerms({ features: input.features, resourceAllowance: input.resourceAllowance, price: money(input.priceMinor) });
      return unitOfWork.run(actor, async (session) => {
        const kind = await apply(session, plan, terms);
        const catalogue = await read(session.repositories);
        return { kind, plans: views(catalogue), previews: catalogue.previews };
      });
    },

    /** A pending change withdrawn, while nobody has moved yet: everyone back where they were. */
    async cancelChange(actor: Actor, plan: Plan) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const catalogue = await read(repositories);
        const { pending } = viewOf(catalogue, plan, today(), todayOf);
        if (pending === null) throw conflict(`Nothing is waiting to change on ${plan}`);
        if (!pending.cancellable) throw conflict("Businesses have started moving; publish a new change instead");
        const planOf = planOfIn(catalogue.editions);
        for (const entry of catalogue.entries) {
          const back: Subscription | null = backFromEdition(entry.subscription, {
            withdrawnId: pending.edition.id,
            previousId: pending.previous.id,
            plan,
            planOf,
          });
          if (back === null) continue;
          const businessId: BusinessId = entry.business.id;
          await repositories.subscriptions.update(businessId, {
            planVersionId: back.planVersionId,
            scheduledMove: back.scheduledMove,
          });
          if (back.planVersionId !== entry.subscription.planVersionId) {
            await resumeWithinAllowance(repositories, businessId, await entitlementOf(repositories, businessId, todayOf(entry)), clock.now());
          }
          await announce(session, { businessId, facts: { kind: "EDITION_CANCELLED", plan }, at: clock.now() });
        }
        await repositories.planVersions.withdraw(pending.edition.id, clock.now());
        return { plans: views(await read(repositories)), previews: catalogue.previews };
      });
    },
  };
};
