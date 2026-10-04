"use client";

import { categoryLabel } from "@tor-now/domain";
import { businessCategories } from "../category-choice.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * ADR 0024: a card names a Business by its main Category, and says how many
 * more it has — the business page lists them all.
 */
export const MainCategoryTag = ({
  business,
  language,
}: {
  business: Pick<BusinessDto, "category" | "categories">;
  language: "he" | "en";
}) => {
  const copy = useCopy("categories");
  const [main, ...others] = businessCategories(business);
  if (main === undefined) return null;
  const names = others.map((code) => categoryLabel(code, language)).join(", ");
  return (
    <span className="cat-tag" title={others.length > 0 ? names : undefined}>
      {categoryLabel(main, language)}
      {others.length > 0 && (
        <>
          <span className="cat-more" aria-hidden="true">+{others.length}</span>
          <span className="visually-hidden">{fillText(copy.others, { names })}</span>
        </>
      )}
    </span>
  );
};

/** The business page: every Category, the main one first. */
export const CategoryTags = ({
  business,
  language,
}: {
  business: Pick<BusinessDto, "category" | "categories">;
  language: "he" | "en";
}) => {
  const copy = useCopy("categories");
  const all = businessCategories(business);
  if (all.length === 0) return null;
  return (
    <ul aria-label={copy.listLabel} className="cat-tags">
      {all.map((code) => (
        <li key={code} className="cat-tag">{categoryLabel(code, language)}</li>
      ))}
    </ul>
  );
};
