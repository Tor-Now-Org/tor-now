"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { Sheet } from "./ui.tsx";
import { SignOutButton } from "./sign-out.tsx";
import { LanguagePill } from "./language-pill.tsx";
import { SUPPORT_PATH, SupportMark } from "./support-link.tsx";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * One identity, two contexts — and one drawer for both.
 *
 * The customer app and the owner app each grew their own account sheet, and
 * they drifted: the same question ("where am I, and where else can I go?") was
 * answered by cards in one and a column of buttons in the other. The person is
 * the same person, so the answer is drawn the same way in both — a list of
 * places, the one you are in marked, and the way out underneath.
 *
 * Which places exist is the caller's business; so is every word, because the
 * two apps read from different dictionaries.
 */
export type AccountPlace = {
  key: string;
  title: string;
  /** A second line: what the place is, or the role you hold there. */
  hint?: string;
  /** The letter or mark in the square. */
  badge: ReactNode;
  /** The place you are in now. Exactly one of them, marked and not offered. */
  current?: boolean;
  onClick: () => void;
};

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  // Kept above the 44px touch target, and no taller: a list of places is
  // read down the names, not the boxes.
  minHeight: 48,
  padding: "6px 12px",
  borderRadius: 14,
  border: "1px solid var(--line)",
  background: "var(--raised)",
  color: "var(--ink)",
  font: "inherit",
  textAlign: "start",
  cursor: "pointer",
};

const BADGE: CSSProperties = {
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  fontSize: 15,
  fontWeight: 600,
};

const CheckMark = () => (
  <span
    style={{
      width: 22,
      height: 22,
      borderRadius: 999,
      display: "grid",
      placeItems: "center",
      background: "var(--accent)",
      color: "var(--on-accent)",
    }}
  >
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  </span>
);

/**
 * The places, drawn.
 *
 * Its own component because the drawer is no longer the only list of them: the
 * header's switch offers the same businesses, and a person should not have to
 * learn two ways of reading the same row — the same badge, the same role, the
 * same mark on the one you are in.
 */
export const PlaceList = ({ places }: { places: readonly AccountPlace[] }) => (
  <>
    {places.map((place) => (
      <button
        key={place.key}
        aria-current={place.current === true}
        onClick={place.onClick}
        style={{
          ...ROW,
          ...(place.current === true
            ? { border: "2px solid var(--accent)", background: "var(--accent-soft)" }
            : {}),
        }}
      >
        <span
          style={{
            ...BADGE,
            background: place.current === true ? "var(--accent-strong)" : "var(--sunken)",
            color: place.current === true ? "var(--on-accent)" : "var(--accent-strong)",
          }}
        >
          {place.badge}
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{place.title}</span>
          {place.hint !== undefined && (
            <span
              style={{
                alignSelf: "flex-start",
                fontSize: 11.5,
                fontWeight: 500,
                padding: "1px 7px",
                borderRadius: 999,
                background: place.current === true ? "var(--raised)" : "var(--sunken)",
                color: place.current === true ? "var(--accent-strong)" : "var(--muted)",
              }}
            >
              {place.hint}
            </span>
          )}
        </span>
        {place.current === true && <CheckMark />}
      </button>
    ))}
  </>
);

export const AccountDrawer = ({
  open,
  onClose,
  userName,
  labels,
  places,
  extra,
  onSignedOut,
}: {
  open: boolean;
  onClose: () => void;
  /** Absent before the session loads, when the drawer cannot be opened anyway. */
  userName?: string;
  labels: { account: string; signOut: string };
  places: AccountPlace[];
  /** Anything the app adds — opening a business, say. Drawn at the top of
   *  the list, where a business of your own would otherwise be. */
  extra?: ReactNode;
  onSignedOut?: () => void;
}) => {
  // The one word the drawer reads for itself: support is a single destination
  // with a single name, so both apps would pass the same string.
  const support = useCopy("support");

  return (
  <Sheet open={open} onClose={onClose} labelledBy="drawer-title">
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {userName !== undefined && (
        <span style={{ fontSize: 19, fontWeight: 700 }}>{userName}</span>
      )}
      {/* What the drawer is, rather than a sentence about the list under it:
          it names the dialog for a screen reader, and it stays true now that
          the list holds support as well as the places you can be. */}
      <h2
        id="drawer-title"
        style={{ fontSize: 15, fontWeight: 500, color: "var(--muted)", marginBlockEnd: 2 }}
      >
        {labels.account}
      </h2>

      {extra}

      <PlaceList places={places} />

      {/* One of the places you can go, drawn like the others: the list asks
          where to continue, and a person is one of the answers. */}
      <Link href={SUPPORT_PATH} style={ROW}>
        <span style={{ ...BADGE, background: "var(--sunken)", color: "var(--accent-strong)" }}>
          <SupportMark />
        </span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{support.supportLink}</span>
      </Link>

      {/* Below the line are the settings of the person rather than places to
          go: leaving, and the language — which has no button in the header, so
          this is where a signed-in person finds it. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderBlockStart: "1px solid var(--line)",
          marginBlockStart: 8,
          paddingBlockStart: 8,
        }}
      >
        <SignOutButton
          label={labels.signOut}
          {...(onSignedOut === undefined ? {} : { onSignedOut })}
          style={{
            // The quiet button is full-width by default; here it shares the
            // line with the language pill and sits at the start.
            width: "auto",
            minHeight: 44,
            padding: "0 12px",
            border: "none",
            background: "transparent",
            color: "var(--critical)",
            fontSize: 15,
            fontWeight: 500,
          }}
        />
        <LanguagePill />
      </div>
    </div>
  </Sheet>
  );
};
