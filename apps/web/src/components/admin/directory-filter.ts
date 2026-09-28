import type { BillingFlag, BillingStatus, DirectoryFilter, FeatureFrom, FeatureName, PlanName } from "@/lib/api/types.ts";

/**
 * The directory's filter as the interface edits it. Pure, so the rules — a
 * second tap undoes the first, a removed token takes exactly its own choice
 * with it — are tested apart from the panel that draws them.
 */

const toggled = <T>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export const toggleStatus = (filter: DirectoryFilter, status: BillingStatus): DirectoryFilter => ({
  ...filter,
  statuses: toggled(filter.statuses, status),
});

export const toggleFlag = (filter: DirectoryFilter, flag: BillingFlag): DirectoryFilter => ({
  ...filter,
  flags: toggled(filter.flags, flag),
});

export const choosePlan = (filter: DirectoryFilter, plan: PlanName | null): DirectoryFilter => ({
  ...filter,
  plan,
});

/** An edition, or all of them; choosing the one already chosen clears it. */
export const chooseEdition = (filter: DirectoryFilter, edition: string | null): DirectoryFilter => ({
  ...filter,
  edition: filter.edition === edition ? null : edition,
});

export const FEATURE_FROM: readonly FeatureFrom[] = ["ANY", "PLAN", "GRANT", "PREVIEW"];

/** The words each source is said in, in the catalogue dictionary. */
export const FROM_KEY: Readonly<Record<FeatureFrom, "fromAny" | "fromPlan" | "fromGrant" | "fromPreview">> = {
  ANY: "fromAny",
  PLAN: "fromPlan",
  GRANT: "fromGrant",
  PREVIEW: "fromPreview",
};

/** A Feature to have, from anywhere at first; choosing it again clears it. */
export const chooseFeature = (filter: DirectoryFilter, feature: FeatureName): DirectoryFilter =>
  filter.feature === feature
    ? { ...filter, feature: null, featureSource: "ANY" }
    : { ...filter, feature, featureSource: "ANY" };

export const chooseFeatureSource = (filter: DirectoryFilter, featureSource: FeatureFrom): DirectoryFilter => ({
  ...filter,
  featureSource,
});

/** Every choice made in the panel; the search is the field's, not the panel's. */
export const choicesMade = (filter: DirectoryFilter): number =>
  filter.statuses.length +
  (filter.plan === null ? 0 : 1) +
  (filter.edition === null ? 0 : 1) +
  filter.flags.length +
  (filter.feature === null ? 0 : 1);

/** Clears the panel's choices and keeps whatever was typed in the search. */
export const resetChoices = (filter: DirectoryFilter): DirectoryFilter => ({
  ...filter,
  statuses: [],
  plan: null,
  edition: null,
  flags: [],
  feature: null,
  featureSource: "ANY",
});

/** One removable token per choice, in the order the panel lists them. */
export type Token =
  | { readonly kind: "status"; readonly value: BillingStatus }
  | { readonly kind: "plan"; readonly value: PlanName }
  | { readonly kind: "edition"; readonly value: string }
  | { readonly kind: "flag"; readonly value: BillingFlag }
  | { readonly kind: "feature"; readonly value: FeatureName; readonly from: FeatureFrom };

export const tokensOf = (filter: DirectoryFilter): Token[] => [
  ...filter.statuses.map((value) => ({ kind: "status" as const, value })),
  ...(filter.plan === null ? [] : [{ kind: "plan" as const, value: filter.plan }]),
  ...(filter.edition === null ? [] : [{ kind: "edition" as const, value: filter.edition }]),
  ...filter.flags.map((value) => ({ kind: "flag" as const, value })),
  ...(filter.feature === null ? [] : [{ kind: "feature" as const, value: filter.feature, from: filter.featureSource }]),
];

export const withoutToken = (filter: DirectoryFilter, token: Token): DirectoryFilter => {
  switch (token.kind) {
    case "status":
      return toggleStatus(filter, token.value);
    case "plan":
      return choosePlan(filter, null);
    case "edition":
      return chooseEdition(filter, token.value);
    case "flag":
      return toggleFlag(filter, token.value);
    case "feature":
      return { ...filter, feature: null, featureSource: "ANY" };
  }
};
