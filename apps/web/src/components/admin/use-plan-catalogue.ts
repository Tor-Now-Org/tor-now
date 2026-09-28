"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { PlanCatalogueDto, PlanName, PlanViewDto } from "@/lib/api/types.ts";
import { useErrorText } from "@/lib/use-error-text.ts";

/**
 * Each Plan as the Catalogue editor sees it — how many Businesses are on it,
 * when they would move, whether a change is waiting — for a sheet that has to
 * say what a change to a Plan will do. Loaded while the sheet is open.
 */
export const usePlanCatalogue = (token: string, open: boolean) => {
  const errorText = useErrorText();
  const [catalogue, setCatalogue] = useState<PlanCatalogueDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    api
      .adminPlans(token)
      .then((loaded) => {
        if (current) setCatalogue(loaded);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      });
    return () => {
      current = false;
    };
  }, [token, open, errorText]);

  const viewOf = (plan: PlanName): PlanViewDto | null => catalogue?.plans.find((view) => view.plan === plan) ?? null;
  const businessesOn = (plan: PlanName): number =>
    viewOf(plan)?.editions.reduce((sum, edition) => sum + edition.businesses, 0) ?? 0;
  return { catalogue, error, viewOf, businessesOn };
};
