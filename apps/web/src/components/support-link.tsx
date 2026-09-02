"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
 * The links in the drawers are only found by somebody already looking, which
 * is the wrong way round: the moment help is wanted is the moment the person
 * is stuck on the screen in front of them. So it rides in the header on every
 * screen, in the corner where the language switch and the account already are.
 *
 * It hides on support itself — a control that goes where you already are is
 * noise — and it is drawn as quietly as the language switch, because it is a
 * way out of trouble, not somewhere the product wants people to go.
 */
export const HelpButton = () => {
  const copy = useCopy("support");
  const pathname = usePathname();

  if (pathname === SUPPORT_PATH) return null;

  return (
    <Link
      href={SUPPORT_PATH}
      aria-label={copy.title}
      title={copy.title}
      style={{
        display: "grid",
        placeItems: "center",
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: 999,
        border: "1px solid var(--line)",
        background: "var(--raised)",
        color: "var(--muted)",
      }}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9.2 9.1a2.9 2.9 0 1 1 3.6 2.82c-.6.16-.98.72-.98 1.34v.74"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="11.85" cy="17.1" r="1.15" fill="currentColor" />
      </svg>
    </Link>
  );
};
