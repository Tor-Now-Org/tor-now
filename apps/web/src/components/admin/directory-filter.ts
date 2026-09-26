import type { BillingFlag, BillingStatus, DirectoryFilter, PlanName } from "@/lib/api/types.ts";

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

/** Every choice made in the panel; the search is the field's, not the panel's. */
export const choicesMade = (filter: DirectoryFilter): number =>
  filter.statuses.length + (filter.plan === null ? 0 : 1) + filter.flags.length;

/** Clears the panel's choices and keeps whatever was typed in the search. */
export const resetChoices = (filter: DirectoryFilter): DirectoryFilter => ({
  ...filter,
  statuses: [],
  plan: null,
  flags: [],
});

/** One removable token per choice, in the order the panel lists them. */
export type Token =
  | { readonly kind: "status"; readonly value: BillingStatus }
  | { readonly kind: "plan"; readonly value: PlanName }
  | { readonly kind: "flag"; readonly value: BillingFlag };

export const tokensOf = (filter: DirectoryFilter): Token[] => [
  ...filter.statuses.map((value) => ({ kind: "status" as const, value })),
  ...(filter.plan === null ? [] : [{ kind: "plan" as const, value: filter.plan }]),
  ...filter.flags.map((value) => ({ kind: "flag" as const, value })),
];

export const withoutToken = (filter: DirectoryFilter, token: Token): DirectoryFilter => {
  switch (token.kind) {
    case "status":
      return toggleStatus(filter, token.value);
    case "plan":
      return choosePlan(filter, null);
    case "flag":
      return toggleFlag(filter, token.value);
  }
};
