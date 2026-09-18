"use client";

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
