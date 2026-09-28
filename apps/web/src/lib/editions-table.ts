import { FEATURES } from "@tor-now/domain";
import type { FeatureName, PlanEditionDto, PlanViewDto } from "@/lib/api/types.ts";

/**
 * Plans' editions side by side (ADR 0020): one column per edition, each row a
 * term, and the cells that differ from the Plan's previous edition in the
 * table marked. Pure, so which columns show and what is marked is tested apart
 * from the sheet that draws it.
 */
export type EditionColumn = PlanEditionDto & {
  readonly current: boolean;
  readonly businesses: number;
  /** Which of this edition's terms differ from the Plan's edition before it in the table. */
  readonly changed: ReadonlySet<"price" | "calendars" | FeatureName>;
};

export type TableMode = "IN_USE" | "CURRENT";

export const editionColumns = (plans: readonly PlanViewDto[], mode: TableMode): readonly EditionColumn[] =>
  plans.flatMap((view) => {
    const shown = [...view.editions]
      .filter((edition) => mode === "IN_USE" || edition.current)
      .sort((a, b) => a.number - b.number);
    return shown.map((edition, at) => {
      const before = at === 0 ? null : shown[at - 1];
      const changed = new Set<"price" | "calendars" | FeatureName>();
      if (before !== null && before !== undefined) {
        if (before.priceMinor !== edition.priceMinor) changed.add("price");
        if (before.resourceAllowance !== edition.resourceAllowance) changed.add("calendars");
        for (const feature of FEATURES) {
          if (before.features.includes(feature) !== edition.features.includes(feature)) changed.add(feature);
        }
      }
      return { ...edition, changed };
    });
  });

/** How many editions have Businesses on them, across every Plan. */
export const editionsInUse = (plans: readonly PlanViewDto[]): number =>
  plans.reduce((sum, view) => sum + view.editions.filter((edition) => edition.businesses > 0 || edition.current).length, 0);
