"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { CatalogueDto, PlanDto } from "@/lib/api/types.ts";

/**
 * The Catalogue, fetched once per page load and shared: every lock names a Plan
 * and its price, and the pricing page, the wizard and the billing tab all
 * read the same Plans — asking once per reader would be a request each. A
 * failed read leaves it empty, and nothing that draws it breaks for that.
 */
const EMPTY: CatalogueDto = { plans: [], previews: [] };
let shared: Promise<CatalogueDto> | null = null;

export const useCatalogue = (): CatalogueDto => {
  const [catalogue, setCatalogue] = useState<CatalogueDto>(EMPTY);
  useEffect(() => {
    let live = true;
    shared ??= api.catalogue().catch(() => {
      shared = null;
      return EMPTY;
    });
    void shared.then((loaded) => {
      if (live) setCatalogue(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  return catalogue;
};

/** The current Plans, cheapest first. */
export const usePlans = (): readonly PlanDto[] => {
  const { plans } = useCatalogue();
  return [...plans].sort((a, b) => a.priceMinor - b.priceMinor);
};

/** What the cheapest Plan costs a month, in whole shekels — null until known. */
export const useFromPrice = (): number | null => usePlans()[0]?.price ?? null;
