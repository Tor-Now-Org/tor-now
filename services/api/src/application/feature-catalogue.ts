import {
  canPreview,
  checkPreviewExtension,
  checkPreviewStart,
  compareLocalDate,
  DomainError,
  extendTerms,
  FEATURES,
  notFound,
  placePreview,
  stretchUndecided,
  timeZone,
  todayIn,
  type Clock,
  type Feature,
  type FeatureSourceKind,
  type LocalDate,
  type Plan,
} from "@tor-now/domain";
import type { DirectoryEntry, PreviewEntry, Repositories } from "../ports/repositories.ts";
import type { Actor, Session, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireAdministrator, requireOperator } from "./authorization.ts";
import { sourcesByBusiness } from "./feature-sources.ts";
import { announce, tell } from "./notices.ts";

/**
 * The Features tab (ADR 0020, ADR 0021): every Feature, where it is sold, and
 * who has it — and Previews, from starting one to deciding which Plans keep
 * its Feature when it ends. A Plan that keeps it gains it at once; one that
 * does not is told thirty days ahead, on WhatsApp too, since it takes value.
 */

/** The Catalogue is the platform's, so its day is Israel's. */
const PLATFORM_ZONE = timeZone("Asia/Jerusalem");

export type FeatureView = {
  readonly feature: Feature;
  /** Each Plan's current edition, and whether it includes the Feature. */
  readonly plans: readonly { readonly plan: Plan; readonly number: number; readonly included: boolean }[];
  /** The running Preview of it, if any. */
  readonly preview: PreviewEntry | null;
  /** How many Businesses have it, by where from. */
  readonly counts: Readonly<Record<Exclude<FeatureSourceKind, "NONE">, number>>;
  readonly canPreview: boolean;
};

const running = (preview: PreviewEntry, today: LocalDate) => compareLocalDate(today, preview.endsOn) <= 0;

export const featureCatalogueService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => {
  const today = () => todayIn(clock.now(), PLATFORM_ZONE);

  const read = async (repositories: Repositories) => {
    const [current, previews, entries] = await Promise.all([
      repositories.planVersions.listCurrent(),
      repositories.previews.listEntries(),
      repositories.subscriptions.directory(),
    ]);
    return { current, previews, entries };
  };

  const views = async (repositories: Repositories): Promise<readonly FeatureView[]> => {
    const { current, previews, entries } = await read(repositories);
    const sources = await sourcesByBusiness(repositories, entries, clock.now());
    const runningPreviews = previews.filter((preview) => running(preview, today()));
    return FEATURES.map((feature) => {
      const counts = { PLAN: 0, GRANT: 0, PREVIEW: 0 };
      for (const list of sources.values()) {
        const source = list.find((candidate) => candidate.feature === feature)?.source;
        if (source !== undefined && source !== "NONE") counts[source] += 1;
      }
      return {
        feature,
        plans: current.map((edition) => ({
          plan: edition.plan,
          number: edition.number,
          included: edition.terms.features.includes(feature),
        })),
        preview: runningPreviews.find((preview) => preview.feature === feature) ?? null,
        counts,
        canPreview: canPreview(feature, { current, previews: runningPreviews, today: today() }),
      };
    });
  };

  /** Businesses whose own Plan does not include a Feature — those a Preview of it reaches. */
  const reachedBy = async (repositories: Repositories, entries: readonly DirectoryEntry[], feature: Feature, plans?: readonly Plan[]) => {
    const versions = await repositories.planVersions.listAll();
    const editionOf = new Map(versions.map((version) => [version.id, version]));
    return entries.filter((entry) => {
      const edition = editionOf.get(entry.subscription.planVersionId);
      return (
        edition !== undefined &&
        !edition.terms.features.includes(feature) &&
        (plans === undefined || plans.includes(edition.plan))
      );
    });
  };

  const tellEach = async (
    repositories: Repositories,
    entries: readonly DirectoryEntry[],
    facts: (entry: DirectoryEntry) => Parameters<typeof tell>[1]["facts"],
  ) => {
    for (const entry of entries) {
      await tell(repositories, { businessId: entry.business.id, facts: facts(entry), at: clock.now() });
    }
  };

  const previewOf = async (repositories: Repositories, feature: Feature): Promise<PreviewEntry> => {
    const preview = (await repositories.previews.listEntries()).find(
      (candidate) => candidate.feature === feature && running(candidate, today()),
    );
    if (preview === undefined) throw notFound("Preview", feature);
    return preview;
  };

  /** Adds a kept Feature to every standing edition of a Plan — a change that only gives. */
  const keepOn = async (session: Session, plan: Plan, feature: Feature): Promise<void> => {
    const editions = (await session.repositories.planVersions.listEditions()).filter(
      (edition) => edition.plan === plan && edition.withdrawnAt === null && !edition.terms.features.includes(feature),
    );
    for (const edition of editions) {
      await session.repositories.planVersions.setTerms(
        edition.id,
        extendTerms(edition.terms, { featuresAdded: [feature], featuresRemoved: [], allowance: null, price: null }),
      );
    }
  };

  return {
    async features(actor: Actor) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, ({ repositories }) => views(repositories));
    },

    /** A Feature into Preview: given at once to everyone whose Plan lacks it, and told so. */
    async startPreview(actor: Actor, feature: Feature, endsOn: LocalDate) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const { current, previews, entries } = await read(repositories);
        checkPreviewStart({ feature, endsOn, current, previews, today: today() });
        await repositories.previews.start(feature, endsOn);
        await tellEach(repositories, await reachedBy(repositories, entries, feature), () => ({
          kind: "PREVIEW_STARTED",
          feature,
          endsOn,
        }));
        return views(repositories);
      });
    },

    async extendPreview(actor: Actor, feature: Feature, endsOn: LocalDate) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const preview = await previewOf(repositories, feature);
        checkPreviewExtension(preview, endsOn, today());
        await repositories.previews.setEnd(feature, endsOn);
        const { entries } = await read(repositories);
        await tellEach(repositories, await reachedBy(repositories, entries, feature), () => ({
          kind: "PREVIEW_EXTENDED",
          feature,
          endsOn,
        }));
        return views(repositories);
      });
    },

    /**
     * Which Plans keep a Preview's Feature when it ends. Decided once: keeping
     * gives, so it applies at once and cannot be taken back without a Notice;
     * the Plans that do not keep it are told now, on WhatsApp too.
     */
    async placePreview(actor: Actor, feature: Feature, keep: readonly Plan[]) {
      requireAdministrator(actor);
      return unitOfWork.run(actor, async (session) => {
        const { repositories } = session;
        const preview = await previewOf(repositories, feature);
        if (preview.placement !== null) {
          throw new DomainError("CONFLICT", "Where this Preview's Feature goes is decided already");
        }
        const placement = placePreview(preview, keep, today());
        await repositories.previews.place(feature, placement, clock.now());
        const { current, entries } = await read(repositories);

        const versions = await repositories.planVersions.listAll();
        const planOf = (entry: DirectoryEntry) =>
          versions.find((version) => version.id === entry.subscription.planVersionId)?.plan;

        const keeping = placement.keepOn.filter((plan) =>
          current.some((edition) => edition.plan === plan && !edition.terms.features.includes(feature)),
        );
        // Who gains it from their Plan is worked out before the Plan changes.
        const keptBy = await reachedBy(repositories, entries, feature, keeping);
        for (const plan of keeping) await keepOn(session, plan, feature);
        for (const entry of keptBy) {
          const plan = planOf(entry);
          if (plan === undefined) continue;
          await tell(repositories, { businessId: entry.business.id, facts: { kind: "PREVIEW_KEPT", feature, plan }, at: clock.now() });
        }

        const losing = current.map((edition) => edition.plan).filter((plan) => !placement.keepOn.includes(plan));
        for (const entry of await reachedBy(repositories, entries, feature, losing)) {
          const plan = planOf(entry);
          if (plan === undefined) continue;
          await announce(session, {
            businessId: entry.business.id,
            facts: { kind: "PREVIEW_LEAVING", feature, plan, endsOn: placement.endsOn },
            at: clock.now(),
          });
        }
        return views(repositories);
      });
    },

    /**
     * The daily run: a Preview nobody decided on, within thirty days of its end,
     * carried thirty days further — so no Plan loses its Feature unannounced.
     */
    async stretchUndecidedPreviews(actor: Actor): Promise<readonly Feature[]> {
      requireOperator(actor);
      return unitOfWork.run(actor, async ({ repositories }) => {
        const stretched: Feature[] = [];
        for (const preview of await repositories.previews.listEntries()) {
          const endsOn = stretchUndecided(preview, today());
          if (endsOn === null) continue;
          await repositories.previews.setEnd(preview.feature, endsOn);
          const { entries } = await read(repositories);
          await tellEach(repositories, await reachedBy(repositories, entries, preview.feature), () => ({
            kind: "PREVIEW_EXTENDED",
            feature: preview.feature,
            endsOn,
          }));
          stretched.push(preview.feature);
        }
        return stretched;
      });
    },
  };
};

