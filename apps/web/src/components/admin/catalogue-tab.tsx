"use client";

import { useState } from "react";
import { useCopy } from "@/lib/i18n/index.tsx";
import { PlansPanel } from "./plans-panel.tsx";
import { RatesPanel } from "./rates-panel.tsx";

type Part = "plans" | "rates";

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
  onShowBusinesses: (editionId: string) => void;
}) => {
  const words = useCopy("catalogue");
  const [part, setPart] = useState<Part>("plans");
  return (
    <>
      <div className="sub-tabs" role="tablist" aria-label={words.tab}>
        {(["plans", "rates"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            role="tab"
            className="chip"
            aria-selected={part === choice}
            onClick={() => setPart(choice)}
          >
            {choice === "plans" ? words.subPlans : words.subRates}
          </button>
        ))}
      </div>
      {part === "plans" ? <PlansPanel token={token} onShowBusinesses={onShowBusinesses} /> : <RatesPanel token={token} />}
    </>
  );
};
