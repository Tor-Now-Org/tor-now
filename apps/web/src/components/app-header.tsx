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

export const AccountButton = ({
  initial,
  onClick,
  label,
}: {
  initial: string;
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
      background: "var(--accent-soft)",
      color: "var(--accent-strong)",
      fontFamily: "Rubik, sans-serif",
      fontSize: 16,
      border: "1px solid oklch(52% 0.123 245/.25)",
    }}
  >
    {initial}
  </button>
);
