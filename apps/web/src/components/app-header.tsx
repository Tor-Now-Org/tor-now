"use client";

import type { ReactNode } from "react";
import { Logo } from "./logo.tsx";
import { useLanguage } from "@/lib/i18n/index.tsx";

/**
 * The header from the canvas: a back affordance or the brand, the language
 * switch, and the account circle. The back chevron points along the reading
 * direction, so it turns around with the language rather than always pointing
 * left.
 */
export const AppHeader = ({
  onBack,
  backLabel,
  title,
  languageLabel,
  trailing,
}: {
  onBack?: () => void;
  backLabel?: string;
  title?: string;
  languageLabel: string;
  trailing?: ReactNode;
}) => {
  const { toggleLanguage, direction } = useLanguage();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 56,
        padding: "0 18px",
        borderBottom: "1px solid var(--line)",
        background: "var(--paper)",
        flexShrink: 0,
      }}
    >
      {onBack !== undefined ? (
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 7, minHeight: 44 }}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            style={{ transform: direction === "rtl" ? "scaleX(-1)" : undefined }}
          >
            <path
              d="m15 6-6 6 6 6"
              stroke="var(--ink)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span style={{ fontSize: 15, color: "var(--muted)" }}>{backLabel}</span>
        </button>
      ) : title !== undefined ? (
        <h1 style={{ fontSize: 17 }}>{title}</h1>
      ) : (
        <Logo />
      )}

      <span
        style={{
          marginInlineStart: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          onClick={toggleLanguage}
          style={{
            minHeight: 40,
            padding: "0 13px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--raised)",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          {languageLabel}
        </button>
        {trailing}
      </span>
    </header>
  );
};

/** The glyph the circle wears when it does not yet stand for anybody. */
const PersonGlyph = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8.6" r="3.6" stroke="currentColor" strokeWidth="1.9" />
    <path
      d="M5 19.4c.9-3.4 3.7-5.2 7-5.2s6.1 1.8 7 5.2"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The same circle in the same corner, whoever is looking.
 *
 * Signed in it carries an initial and opens the account; signed out it carries
 * a person and opens sign-in — one control with two states rather than a
 * control that is simply absent, which is what left a first-time visitor with
 * no way into the system from the front door. The signed-out state is drawn
 * quieter, because a filled circle in that corner reads as an account that
 * already exists.
 */
export const AccountButton = ({
  initial,
  onClick,
  label,
}: {
  /** Absent when nobody is signed in. */
  initial?: string;
  onClick: () => void;
  label: string;
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    style={{
      display: "grid",
      placeItems: "center",
      width: 40,
      height: 40,
      borderRadius: 999,
      background: initial === undefined ? "var(--raised)" : "var(--accent-soft)",
      color: initial === undefined ? "var(--muted)" : "var(--accent-strong)",
      fontFamily: "Rubik, sans-serif",
      fontSize: 16,
      border:
        initial === undefined
          ? "1px solid var(--line)"
          : "1px solid oklch(52% 0.123 245/.25)",
    }}
  >
    {initial ?? <PersonGlyph />}
  </button>
);
