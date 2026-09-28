"use client";

import { useState } from "react";
import type { DirectoryFilter } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { FeaturesPanel } from "./features-panel.tsx";
import { PlansPanel } from "./plans-panel.tsx";
import { RatesPanel } from "./rates-panel.tsx";

type Part = "plans" | "features" | "rates";

/**
 * The administrator's Catalogue (ADR 0021): what every Plan offers and costs,
 * and what each message costs the platform. Plans first — they are what
 * Businesses buy.
 */
export const CatalogueTab = ({
  token,
  onShowBusinesses,
}: {
  token: string;
  /** Opens the Businesses list, filtered. */
  onShowBusinesses: (filter: Partial<DirectoryFilter>) => void;
}) => {
  const words = useCopy("catalogue");
  const [part, setPart] = useState<Part>("plans");
  return (
    <>
      <div className="sub-tabs" role="tablist" aria-label={words.tab}>
        {(["plans", "features", "rates"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            role="tab"
            className="chip"
            aria-selected={part === choice}
            onClick={() => setPart(choice)}
          >
            {choice === "plans" ? words.subPlans : choice === "features" ? words.subFeatures : words.subRates}
          </button>
        ))}
      </div>
      {part === "plans" && (
        <PlansPanel token={token} onShowBusinesses={(edition) => onShowBusinesses({ edition })} />
      )}
      {part === "features" && (
        <FeaturesPanel token={token} onShowBusinesses={onShowBusinesses} onPlans={() => setPart("plans")} />
      )}
      {part === "rates" && <RatesPanel token={token} />}
    </>
  );
};
