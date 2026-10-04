import {
  categoryGroupsOf,
  MAX_CATEGORIES,
  type BusinessCategory,
  type CategoryGroup,
} from "@tor-now/domain";

/**
 * ADR 0024: choosing a Business's Categories — up to three, the first the main
 * one. Pure, so the rules the chooser follows are tested apart from the screen.
 */

type Chosen = readonly BusinessCategory[];

/** After the ones already chosen, so the main one stays first. */
export const addCategory = (chosen: Chosen, code: BusinessCategory): Chosen =>
  chosen.includes(code) || categoriesFull(chosen) ? chosen : [...chosen, code];

/** Removing the main one makes the next one main. */
export const removeCategory = (chosen: Chosen, code: BusinessCategory): Chosen =>
  chosen.filter((one) => one !== code);

export const makeMain = (chosen: Chosen, code: BusinessCategory): Chosen =>
  chosen.includes(code) ? [code, ...chosen.filter((one) => one !== code)] : chosen;

export const categoriesFull = (chosen: Chosen): boolean => chosen.length >= MAX_CATEGORIES;

/**
 * The parent groups, when the choice spans more than one — worth a word, since
 * it is often a slip, and never a refusal, since a clinic may also tattoo.
 */
export const separateFields = (chosen: Chosen): readonly CategoryGroup[] | null => {
  const groups = categoryGroupsOf(chosen);
  return groups.length > 1 ? groups : null;
};

type HasCategories = {
  readonly category?: BusinessCategory | null | undefined;
  readonly categories?: readonly BusinessCategory[] | undefined;
};

/** The list, or the single field an API from before ADR 0024 sends instead. */
export const businessCategories = (business: HasCategories): Chosen =>
  business.categories ?? (business.category == null ? [] : [business.category]);

/** How many beyond the main one, for a card that names only that one. */
export const otherCategoriesCount = (business: HasCategories): number =>
  Math.max(0, businessCategories(business).length - 1);
