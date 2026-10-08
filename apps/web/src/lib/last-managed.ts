"use client";

import { api } from "./api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";

/**
 * The business somebody was last managing, on this device.
 *
 * What makes the header's switch one tap rather than a question: "ניהול" means
 * "the diary I was in", and for an owner of one business it always did. For an
 * owner of several it used to mean "ask me which", every single time, and the
 * answer was almost always the one from an hour ago.
 *
 * Deliberately per-device and deliberately not on the server. It is a
 * convenience, not a setting — there is nothing to reconcile if two phones
 * disagree, and a new phone falling back to the first business is a correct
 * answer rather than a missing one.
 */
const KEY = "tor-now.last-managed";

export const lastManaged = (): string | null => {
  try {
    const held = window.localStorage.getItem(KEY);
    return held === null || held === "" ? null : held;
  } catch {
    // A private window, or a browser told to keep nothing. The switch still
    // works; it simply opens the first business.
    return null;
  }
};

export const rememberManaged = (businessId: string): void => {
  try {
    window.localStorage.setItem(KEY, businessId);
  } catch {
    // See above: forgetting is survivable, so it is not worth an error.
  }
};

/**
 * The businesses as last fetched, held in memory for the life of the tab.
 *
 * Crossing over is a route change, and a route change is a fresh mount: without
 * this the new side starts knowing nothing, draws its header without the switch
 * while it asks again, and the switch you just pressed blinks out and back.
 * With it the header is whole on the first frame, and only the content refreshes.
 */
let known: BusinessDto[] | null = null;

export const knownBusinesses = (): BusinessDto[] | null => known;

export const rememberBusinesses = (businesses: BusinessDto[] | null): void => {
  known = businesses;
};

/**
 * The businesses, asked for once however many screens want them at the same time.
 *
 * Opening the app at `/` asks for them, then hands over to /manage, which asks
 * again — and the second answer is what /manage waits on. Joining the request
 * already in the air makes that one round trip. Only a request still in flight
 * is shared: a reload after a change must ask afresh, so `join` is opt-in.
 */
let inFlight: { token: string; answer: Promise<BusinessDto[]> } | null = null;

export const fetchBusinesses = (
  token: string,
  { join = false }: { join?: boolean } = {},
): Promise<BusinessDto[]> => {
  if (join && inFlight?.token === token) return inFlight.answer;
  const entry = { token, answer: api.myBusinesses(token) };
  inFlight = entry;
  const settled = () => {
    if (inFlight === entry) inFlight = null;
  };
  entry.answer.then(settled, settled);
  return entry.answer;
};

/**
 * Which business "ניהול" opens, given what somebody owns.
 *
 * The remembered one while it is still theirs — a business can be left, or
 * closed, and a remembered id that no longer matches anything must not become
 * a dead end. Otherwise the first, which is the only answer available on a
 * device that has never been used to manage anything.
 */
export const businessToManage = <T extends { id: string }>(
  businesses: readonly T[],
  remembered: string | null,
): T | null => {
  if (businesses.length === 0) return null;
  const held = businesses.find((one) => one.id === remembered);
  return held ?? businesses[0] ?? null;
};
