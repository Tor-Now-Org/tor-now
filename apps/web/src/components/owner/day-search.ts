"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { CalendarAppointmentDto } from "@/lib/api/types.ts";

/**
 * Finding an appointment by who booked it.
 *
 * A customer rings up about a time two months out. The calendar answers "what
 * is on this day", which is the wrong question — the owner knows the name and
 * not the date, and paging forward until it appears is a search conducted by
 * scrolling.
 *
 * The answer has to say which question it answers. Holding it as a bare list
 * meant the screen could not tell a result from a leftover: the list stayed on
 * screen while the next letter was being typed and its request was in flight,
 * so the matches for "יע" were shown under "יעל" as though they were its
 * answer. Nothing was ever wrong for long, which is exactly why it read as the
 * search being unreliable rather than as a bug.
 *
 * A failure said even less. It set the list to empty, so a dropped request and
 * a customer who genuinely has nothing were the same screen: "no matches",
 * confidently, about a question nobody had managed to ask.
 */
export type Search =
  /** Too little to go on. Fewer than two characters is everybody. */
  | { readonly state: "idle" }
  | { readonly state: "searching"; readonly of: string }
  | {
      readonly state: "found";
      readonly of: string;
      readonly matches: readonly CalendarAppointmentDto[];
    }
  | { readonly state: "failed"; readonly of: string };

export const IDLE: Search = { state: "idle" };

/** A short wait, so typing a name is one request rather than one per letter. */
export const SEARCH_SETTLE_MS = 250;

/** Below this a search is about everybody, which is not a search. */
export const SEARCH_MINIMUM = 2;

export const wantsAnswer = (query: string): boolean =>
  query.trim().length >= SEARCH_MINIMUM;

/**
 * The matches to draw under a query, and nothing else.
 *
 * The guard is `of === query`: an answer is only ever shown above the question
 * it was asked of. Everything else — a stale answer, one still in flight, one
 * that failed — is not a list, and the screen has to say so rather than draw
 * the last list it happened to be holding.
 */
export const answerTo = (
  search: Search,
  query: string,
): readonly CalendarAppointmentDto[] | null =>
  search.state === "found" && search.of === query.trim() ? search.matches : null;

/** Whether the screen owes the reader a spinner rather than an answer. */
export const isPending = (search: Search, query: string): boolean =>
  wantsAnswer(query) &&
  (search.state === "idle" ||
    search.of !== query.trim() ||
    search.state === "searching");

export const hasFailed = (search: Search, query: string): boolean =>
  search.state === "failed" && search.of === query.trim();

/**
 * The search, run.
 *
 * Every answer carries the query it answers, so a slow request landing after a
 * newer one cannot be mistaken for the newer one's result — the render drops it
 * on the `of` check rather than relying on the effect's cleanup having won a
 * race it cannot see.
 */
export const useAppointmentSearch = (
  token: string,
  businessId: string,
  query: string,
): Search => {
  const [search, setSearch] = useState<Search>(IDLE);

  useEffect(() => {
    const trimmed = query.trim();
    if (!wantsAnswer(trimmed)) {
      setSearch(IDLE);
      return;
    }

    let current = true;
    setSearch({ state: "searching", of: trimmed });
    const timer = window.setTimeout(() => {
      api
        .searchAppointments(token, businessId, trimmed)
        .then((matches) => {
          if (current) setSearch({ state: "found", of: trimmed, matches });
        })
        .catch(() => {
          if (current) setSearch({ state: "failed", of: trimmed });
        });
    }, SEARCH_SETTLE_MS);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, token, businessId]);

  return search;
};
