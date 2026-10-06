"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { DayAvailabilityDto } from "@/lib/api/types.ts";
import { pagesFor } from "./days-model.ts";

/**
 * ADR 0026: the days a customer has looked at, asked for two weeks at a time.
 *
 * ADR 0003 still holds — nothing polls and nothing subscribes. A page is asked
 * for when the strip or the month first needs it, asked again on `refresh`
 * (after a time turned out to be taken), and forgotten whenever the service or
 * the calendar changes, because what is free depends on both.
 */
export const useDays = ({
  businessId,
  serviceId,
  resourceId,
  today,
  lastDay,
  seed,
  onError,
}: {
  businessId: string;
  serviceId: string | null;
  resourceId: string | null;
  today: string;
  lastDay: string;
  /** Days the business page already carried, and the combination they answer. */
  seed: { serviceId: string; resourceId: string; days: readonly DayAvailabilityDto[] } | null;
  onError: (cause: unknown) => void;
}) => {
  const [days, setDays] = useState<Readonly<Record<string, DayAvailabilityDto>>>({});
  /** Pages asked for under the current combination, by their first date. */
  const asked = useRef<Set<string>>(new Set());
  /** Bumped on every change of combination, so a late answer to an old one is dropped. */
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    asked.current = new Set();
    const seeded =
      seed !== null && seed.serviceId === serviceId && seed.resourceId === resourceId ? seed.days : [];
    for (const page of seeded.length === 0 ? [] : pagesFor(today, lastDay, seeded[0]!.date, seeded.at(-1)!.date)) {
      asked.current.add(page.from);
    }
    setDays(Object.fromEntries(seeded.map((day) => [day.date, day])));
  }, [seed, serviceId, resourceId, today, lastDay]);

  const load = useCallback(
    async (from: string, to: string, force: boolean) => {
      if (serviceId === null || resourceId === null) return;
      const ours = generation.current;
      const pages = pagesFor(today, lastDay, from, to).filter((page) => force || !asked.current.has(page.from));
      for (const page of pages) asked.current.add(page.from);
      await Promise.all(
        pages.map(async (page) => {
          try {
            const loaded = await api.availability(businessId, { serviceId, resourceId, ...page });
            if (ours !== generation.current) return;
            setDays((before) => ({ ...before, ...Object.fromEntries(loaded.map((day) => [day.date, day])) }));
          } catch (cause) {
            // Forgotten, so the next look at these days asks again.
            if (ours === generation.current) asked.current.delete(page.from);
            onError(cause);
          }
        }),
      );
    },
    [businessId, serviceId, resourceId, today, lastDay, onError],
  );

  /** Ask for whatever of these dates has not been asked for yet. */
  const ensure = useCallback((from: string, to: string) => load(from, to, false), [load]);
  /** Ask again for the pages holding these dates, whatever is already known. */
  const refresh = useCallback((from: string, to: string) => load(from, to, true), [load]);

  return { days, ensure, refresh };
};
