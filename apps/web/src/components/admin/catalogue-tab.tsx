"use client";

import { useState } from "react";
import type { DirectoryFilter } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { CostsPart, type CostPart } from "./costs/costs-part.tsx";
import { FeaturesPanel } from "./features-panel.tsx";
import { PlansPanel } from "./plans-panel.tsx";
import { RatesPanel } from "./rates-panel.tsx";

export type CataloguePart = "plans" | "features" | "rates" | "costs";
export const CATALOGUE_PARTS: readonly CataloguePart[] = ["plans", "features", "rates", "costs"];

/**
 * The administrator's Catalogue (ADR 0021, ADR 0023): what every Plan offers
 * and costs, what each message costs the platform, and what Businesses and
 * the platform cost. Plans first — they are what Businesses buy.
 */
export const CatalogueTab = ({
  token,
  initial = { part: "plans" },
  onShowBusinesses,
  onOpenBusiness,
}: {
  token: string;
  /** Where to open: a banner elsewhere can send the administrator straight to Fair Use. */
  initial?: { part: CataloguePart; costs?: CostPart };
  /** Opens the Businesses list, filtered. */
  onShowBusinesses: (filter: Partial<DirectoryFilter>) => void;
  /** Opens one Business's sheet. */
  onOpenBusiness: (businessId: string) => void;
}) => {
  const words = useCopy("catalogue");
  const costs = useCopy("costs");
  const [part, setPart] = useState<CataloguePart>(initial.part);
  const label: Record<CataloguePart, string> = {
    plans: words.subPlans,
    features: words.subFeatures,
    rates: words.subRates,
    costs: costs.tab,
  };
  return (
    <>
      <div className="sub-tabs" role="tablist" aria-label={words.tab}>
        {CATALOGUE_PARTS.map((choice) => (
          <button
            key={choice}
            type="button"
            role="tab"
            className="chip"
            aria-selected={part === choice}
            onClick={() => setPart(choice)}
          >
            {label[choice]}
          </button>
        ))}
      </div>
      {part === "plans" && (
        <PlansPanel token={token} onShowBusinesses={(edition) => onShowBusinesses({ edition })} />
      )}
      {part === "features" && (
        <FeaturesPanel token={token} onShowBusinesses={onShowBusinesses} />
      )}
      {part === "rates" && <RatesPanel token={token} />}
      {part === "costs" && (
        <CostsPart
          token={token}
          {...(initial.part === "costs" && initial.costs !== undefined ? { initial: initial.costs } : {})}
          onOpenBusiness={onOpenBusiness}
          onShowRates={() => setPart("rates")}
        />
      )}
    </>
  );
};
