"use client";

import { useState } from "react";
import { useCopy } from "@/lib/i18n/index.tsx";
import { CalculatorPart } from "./calculator-part.tsx";
import { FairUsePart } from "./fair-use-part.tsx";
import { MonthPart } from "./month-part.tsx";

/** The Catalogue's Cost tab (ADR 0023): this month, the calculator, and Fair Use. */

export const COST_PARTS = ["month", "calculator", "fairUse"] as const;
export type CostPart = (typeof COST_PARTS)[number];

export const CostsPart = ({
  token,
  initial = "month",
  onOpenBusiness,
  onShowRates,
}: {
  token: string;
  initial?: CostPart;
  onOpenBusiness: (businessId: string) => void;
  onShowRates: () => void;
}) => {
  const words = useCopy("costs");
  const [part, setPart] = useState<CostPart>(initial);
  const label: Record<CostPart, string> = { month: words.partMonth, calculator: words.partCalculator, fairUse: words.partFairUse };
  return (
    <>
      <div className="fp-seg costs-parts" role="tablist" aria-label={words.tab}>
        {COST_PARTS.map((choice) => (
          <button key={choice} type="button" role="tab" aria-selected={part === choice} aria-pressed={part === choice} onClick={() => setPart(choice)}>
            {label[choice]}
          </button>
        ))}
      </div>
      {part === "month" && <MonthPart token={token} onOpenBusiness={onOpenBusiness} onShowRates={onShowRates} />}
      {part === "calculator" && <CalculatorPart token={token} />}
      {part === "fairUse" && <FairUsePart token={token} onOpenBusiness={onOpenBusiness} />}
    </>
  );
};
