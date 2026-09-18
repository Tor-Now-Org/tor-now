"use client";

import Link from "next/link";

import { useCopy } from "@/lib/i18n/index.tsx";

/** One place, so nothing links to a path that only nearly matches. */
export const SUPPORT_PATH = "/support";

/**
 * The way to a person.
 *
 * It sits wherever somebody is most likely to be stuck — the two account
 * drawers and the sign-in screen — and reads its own words, so a screen that
 * wants it does not have to carry a support string in its own dictionary.
 *
 * Deliberately quiet: it is the last resort on the screen, not a call to
 * action competing with what the screen is actually for.
 */
export const SupportLink = () => {
  const copy = useCopy("support");

  return (
    <Link
      href={SUPPORT_PATH}
      style={{
        alignSelf: "center",
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        fontSize: 13.5,
        color: "var(--muted)",
      }}
    >
      {copy.supportLink}
    </Link>
  );
};

/**
 * The same destination, as a mark rather than a word.
 *
 * Only the glyph: it is worn by the drawer's support row, which supplies its
 * own box and its own name. It stays here so the mark and the path it stands
 * for cannot drift apart.
 */
export const SupportMark = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M9.2 9.1a2.9 2.9 0 1 1 3.6 2.82c-.6.16-.98.72-.98 1.34v.74"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
    <circle cx="11.85" cy="17.1" r="1.15" fill="currentColor" />
  </svg>
);
