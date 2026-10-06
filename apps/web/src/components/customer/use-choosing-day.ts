"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BusinessDto, DayAvailabilityDto } from "@/lib/api/types.ts";
import { addDaysTo, todayIn } from "@/lib/format.ts";
import {
  firstFree,
  lastBookableDay,
  markOf,
  readPart,
  reachesPastStrip,
  stripDates,
  whenOpens,
  type Mark,
  type PartChoice,
} from "./days-model.ts";
import { useDays } from "./use-days.ts";

/** Where the chosen Part of Day is kept between visits, on this device only. */
const PART_KEY = "tor-now.when";

const readStoredPart = (): PartChoice => {
  try {
    return readPart(window.localStorage.getItem(PART_KEY));
  } catch {
    // Storage refused (a private window, blocked site data): any time.
    return "any";
  }
};

const storePart = (part: PartChoice): void => {
  try {
    window.localStorage.setItem(PART_KEY, part);
  } catch {
    // Not remembered next time, which is all that is lost.
  }
};

/**
 * ADR 0026: which day the customer is looking at, and what every day says.
 *
 * The page opens on the first day with room in the chosen part of the day —
 * once every day before it has answered — and follows that until the customer
 * picks a day themselves, after which their pick is kept.
 */
export const useChoosingDay = ({
  business,
  serviceId,
  resourceId,
  seed,
  onError,
}: {
  business: BusinessDto;
  serviceId: string | null;
  resourceId: string | null;
  seed: { serviceId: string; resourceId: string; days: readonly DayAvailabilityDto[] } | null;
  onError: (cause: unknown) => void;
}) => {
  const timeZone = business.timeZone;
  const horizonDays = business.bookingHorizonDays;
  const today = useMemo(() => todayIn(timeZone), [timeZone]);
  const lastDay = useMemo(() => lastBookableDay(new Date(), timeZone, horizonDays), [timeZone, horizonDays]);

  const [date, setDate] = useState(today);
  const [byHand, setByHand] = useState(false);
  const [part, setPartState] = useState<PartChoice>("any");

  // Read after mounting: the server rendered without the device's storage.
  useEffect(() => setPartState(readStoredPart()), []);

  const setPart = useCallback((chosen: PartChoice) => {
    setPartState(chosen);
    storePart(chosen);
  }, []);

  const { days, ensure, refresh } = useDays({
    businessId: business.id,
    serviceId,
    resourceId,
    today,
    lastDay,
    seed,
    onError,
  });

  const firstPage = useMemo(() => stripDates(today, lastDay, null), [today, lastDay]);
  const strip = useMemo(
    () => stripDates(today, lastDay, byHand ? date : null),
    [today, lastDay, byHand, date],
  );

  useEffect(() => {
    void ensure(strip[0]!, strip.at(-1)!);
  }, [ensure, strip]);

  const answered = firstPage.every((day) => days[day] !== undefined);
  const opening = firstFree(firstPage, days, part, timeZone);

  useEffect(() => {
    if (byHand) return;
    if (opening !== null) setDate(opening);
    else if (answered) setDate(today);
  }, [byHand, opening, answered, today]);

  const choose = useCallback((picked: string) => {
    setByHand(true);
    setDate(picked);
  }, []);

  const marks: Readonly<Record<string, Mark>> = Object.fromEntries(
    strip.map((day) => [day, markOf(days[day], part, timeZone, today, horizonDays)]),
  );

  const dayAfter = addDaysTo(lastDay, 1);
  const refreshDay = useCallback(() => refresh(date, date), [refresh, date]);

  return {
    today,
    lastDay,
    date,
    choose,
    part,
    setPart,
    days,
    day: days[date],
    strip,
    marks,
    ensure,
    /** Ask again about the day being looked at, after a time turned out to be taken. */
    refreshDay,
    /** The first two weeks have answered, and not one day in them has room. */
    noneSoon: answered && opening === null,
    showsMonth: reachesPastStrip(today, lastDay),
    nextOpening:
      strip.at(-1) === lastDay ? { date: dayAfter, when: whenOpens(dayAfter, today, horizonDays) } : null,
  };
};
