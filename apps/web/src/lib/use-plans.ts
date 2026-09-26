"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { PlanDto } from "@/lib/api/types.ts";

/**
 * The Catalogue's current Plans, fetched once per page load and shared: every
 * lock on a screen names a Plan and its price, and asking once per lock would
 * be a request for each. A failed read leaves the list empty, and a lock with
 * no Plan to name still says what is missing.
 */
let shared: Promise<PlanDto[]> | null = null;

export const usePlans = (): readonly PlanDto[] => {
  const [plans, setPlans] = useState<readonly PlanDto[]>([]);
  useEffect(() => {
    let live = true;
    shared ??= api.plans().catch(() => {
      shared = null;
      return [];
    });
    void shared.then((loaded) => {
      if (live) setPlans(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  return plans;
};
