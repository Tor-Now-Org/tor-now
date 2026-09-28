import { validationFailed } from "../shared/errors.ts";
import { TEXT_RULES } from "../model/text.ts";
import { addDays, compareLocalDate, type LocalDate } from "../time/local-date.ts";
import { addonRuns, trialGives, type AddonTerm, type GrantTerm, type Preview, type TrialAddons } from "./entitlement.ts";
import { FEATURES, type Feature } from "./feature.ts";
import type { PlanTerms } from "./plan.ts";

/**
 * Where each of a Business's Features comes from today, and what an
 * administrator may grant it (ADR 0021). One list for the administrator and the
 * owner alike, so the two never disagree about what a Business has.
 */

/** How far ahead a Grant may run. Anything meant to last longer is a Plan Version. */
export const MAX_GRANT_DAYS = 365;

export const FEATURE_SOURCES = ["PLAN", "ADDON", "GRANT", "PREVIEW", "NONE"] as const;
export type FeatureSourceKind = (typeof FEATURE_SOURCES)[number];

export type FeatureSource<G extends GrantTerm = GrantTerm> = {
  readonly feature: Feature;
  readonly source: FeatureSourceKind;
  /**
   * The last day it is given: a Grant's or a Preview's end, a cancelled
   * Add-on's, or the Trial's for one it includes. Null from the Plan, from an
   * Add-on running on, or not at all.
   */
  readonly endsOn: LocalDate | null;
  /** The Grant it comes from, when it does. */
  readonly grant: G | null;
};

const runsThrough = (endsOn: LocalDate, today: LocalDate): boolean => compareLocalDate(today, endsOn) <= 0;

/** The longest-running of the Grants given, among those still running. */
const latest = <G extends GrantTerm>(grants: readonly G[]): G | null =>
  grants.reduce<G | null>(
    (best, grant) => (best === null || compareLocalDate(grant.endsOn, best.endsOn) > 0 ? grant : best),
    null,
  );

/**
 * Every Feature, each with the one place it comes from: the Plan first — a
 * Grant of something the Plan includes changes nothing — then an Add-on,
 * bought or included in the Trial, then a Grant, then a Preview, else nowhere.
 */
export const featureSources = <G extends GrantTerm>(input: {
  terms: Pick<PlanTerms, "features">;
  grants: readonly G[];
  previews: readonly Preview[];
  addons: readonly AddonTerm[];
  trialAddons: TrialAddons | null;
  today: LocalDate;
}): readonly FeatureSource<G>[] =>
  FEATURES.map((feature): FeatureSource<G> => {
    if (input.terms.features.includes(feature)) return { feature, source: "PLAN", endsOn: null, grant: null };
    const addon = input.addons.find((a) => a.feature === feature && addonRuns(a, input.today));
    if (addon !== undefined) return { feature, source: "ADDON", endsOn: addon.endsOn, grant: null };
    if (input.trialAddons !== null && trialGives(input.trialAddons, feature, input.today)) {
      return { feature, source: "ADDON", endsOn: input.trialAddons.endsOn, grant: null };
    }
    const grant = latest(input.grants.filter((g) => g.feature === feature && runsThrough(g.endsOn, input.today)));
    if (grant !== null) return { feature, source: "GRANT", endsOn: grant.endsOn, grant };
    const preview = input.previews.find((p) => p.feature === feature && runsThrough(p.endsOn, input.today));
    if (preview !== undefined) return { feature, source: "PREVIEW", endsOn: preview.endsOn, grant: null };
    return { feature, source: "NONE", endsOn: null, grant: null };
  });

/** Only what a Business does not have some other way can be granted. */
export const grantableFeatures = (sources: readonly FeatureSource[]): readonly Feature[] =>
  sources.filter((source) => source.source === "NONE").map((source) => source.feature);

const requireReason = (reason: string): string => {
  const trimmed = reason.trim();
  if (trimmed.length < TEXT_RULES.auditReason.min || trimmed.length > TEXT_RULES.auditReason.max) {
    throw validationFailed("A Grant needs a reason", { field: "reason" });
  }
  return trimmed;
};

const requireEnd = (endsOn: LocalDate, today: LocalDate): void => {
  if (compareLocalDate(endsOn, today) < 0) {
    throw validationFailed("A Grant ends today or later", { field: "endsOn" });
  }
  if (compareLocalDate(endsOn, addDays(today, MAX_GRANT_DAYS)) > 0) {
    throw validationFailed("A Grant runs at most a year ahead", { field: "endsOn", maxDays: MAX_GRANT_DAYS });
  }
};

/**
 * Checks new Grants against what the Business already has, and returns the
 * reason as it will be kept. Every Feature asked for must be grantable; asking
 * for one twice asks once.
 */
export const checkGrants = (input: {
  features: readonly Feature[];
  endsOn: LocalDate;
  reason: string;
  sources: readonly FeatureSource[];
  today: LocalDate;
}): { readonly features: readonly Feature[]; readonly reason: string } => {
  const features = FEATURES.filter((feature) => input.features.includes(feature));
  if (features.length === 0) throw validationFailed("Choose at least one Feature", { field: "features" });
  const grantable = grantableFeatures(input.sources);
  const refused = features.filter((feature) => !grantable.includes(feature));
  if (refused.length > 0) {
    throw validationFailed("The Business already has these Features", { field: "features", features: refused });
  }
  requireEnd(input.endsOn, input.today);
  return { features, reason: requireReason(input.reason) };
};

/** A running Grant carried to a later day. */
export const checkExtension = (input: {
  grant: GrantTerm;
  endsOn: LocalDate;
  reason: string;
  today: LocalDate;
}): string => {
  if (!runsThrough(input.grant.endsOn, input.today)) {
    throw validationFailed("Only a running Grant can be extended", { field: "grant" });
  }
  if (compareLocalDate(input.endsOn, input.grant.endsOn) <= 0) {
    throw validationFailed("An extension ends later than the Grant does", { field: "endsOn" });
  }
  requireEnd(input.endsOn, input.today);
  return requireReason(input.reason);
};

/**
 * The last day a Grant ended now applies: yesterday, so it stops today. What
 * was made with it stays; only new use stops (ADR 0019).
 */
export const endedGrantEndsOn = (today: LocalDate): LocalDate => addDays(today, -1);
