"use client";

import type { Language } from "@/lib/i18n/dictionaries.ts";
import { useLanguage } from "@/lib/i18n/index.tsx";

/**
 * The mark and the wordmark.
 *
 * The mark is a calendar with a checked day and a clock — a booked time — and
 * carries the brand's navy, blue and cyan.
 */
export const LogoMark = ({ size = 26 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <path d="M11 2.6v3.2M18.5 2.6v3.2" stroke="#0A2450" strokeWidth="2.6" strokeLinecap="round" />
    <rect x="3.4" y="5.2" width="21" height="19.6" rx="4.6" stroke="#0A2450" strokeWidth="2.2" />
    <path d="M4 11.4h19.8" stroke="#0A2450" strokeWidth="1.7" />
    <rect x="7.4" y="14.4" width="6.6" height="6.6" rx="2.1" fill="#22BFD4" />
    <path d="M9.1 17.6l1.4 1.4 2.3-2.7" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="23.2" cy="22.2" r="7.4" fill="var(--raised)" />
    <circle cx="23.2" cy="22.2" r="6.1" stroke="#1470AA" strokeWidth="2.2" />
    <path d="M23.2 18.6v3.6l2.5 1.6" stroke="#0A2450" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The name, in the reader's own language.
 *
 * "תור פנוי" is two Hebrew words — a free appointment — so unlike the previous
 * name it has a genuine English form rather than a transliterated half. Both
 * are set the same way: the noun in navy, the adjective in the mark's own
 * blue-to-cyan gradient, so the wordmark reads as one object in either script.
 *
 * Each form carries its own direction, because a name is not a sentence to be
 * mirrored: the Hebrew stays right-to-left inside an English page and the
 * English stays left-to-right inside a Hebrew one.
 */
type WordmarkForm = {
  readonly lead: string;
  readonly trail: string;
  readonly dir: "rtl" | "ltr";
};

const WORDMARK: Readonly<Record<Language, WordmarkForm>> = Object.freeze({
  he: { lead: "תור", trail: "פנוי", dir: "rtl" },
  en: { lead: "Tor", trail: "Panuy", dir: "ltr" },
});

export const Wordmark = ({ size = 19 }: { size?: number }) => {
  const { language } = useLanguage();
  const name = WORDMARK[language];
  return (
    <span className="wordmark" style={{ fontSize: size }} dir={name.dir}>
      <span className="wordmark-lead">{name.lead}</span>
      <span className="wordmark-trail">{name.trail}</span>
    </span>
  );
};

export const Logo = ({ size = 26 }: { size?: number }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
    <LogoMark size={size} />
    <Wordmark {...(size > 26 ? { size: Math.round(size * (19 / 26)) } : {})} />
  </span>
);
