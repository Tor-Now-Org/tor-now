"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/lib/i18n/index.tsx";
import { SOLO_PRICE } from "@/lib/plans.ts";
import { BuildingIcon } from "./bottom-nav.tsx";
import { Button } from "./ui.tsx";

/**
 * The invitation to open a Business, in the two places it is offered.
 *
 * Both lead to the pricing page rather than straight into the wizard: what
 * stops a person here is the price, and the wizard does not name one. Both are
 * shown only to somebody who holds no owner Membership — a fact the caller
 * already knows, and asking again here would be a second answer that could
 * disagree with the first.
 *
 * They are not the same card, because they are not the same moment. In the
 * search results the person was not asking, so it opens with the question and
 * can be sent away. In the drawer they came looking for where else they can
 * go, so it is a place among the places: a line, a price, and the way in.
 */

const GROUND: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  background: "var(--accent-soft)",
  border: "1px solid oklch(52% 0.123 245/.22)",
};

const MARK: CSSProperties = {
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  borderRadius: 11,
  background: "var(--raised)",
  color: "var(--accent-strong)",
};

/** The drawer's: one more place this person could be, priced. */
export const OwnerPitch = () => {
  const copy = useCopy("customer");
  const router = useRouter();

  return (
    <div
      style={{
        ...GROUND,
        gap: 11,
        padding: 14,
        // The mark's own cyan, as a floor under the accent: it marks this out
        // as the one row in the drawer that is an offer rather than a place.
        background: "linear-gradient(0deg, var(--accent-soft), var(--cyan-soft))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ ...MARK, width: 34, height: 34 }}>
          <BuildingIcon />
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{copy.openBusiness}</span>
          <span className="hint">{copy.pitchSameSignIn}</span>
        </span>
        <span
          className="tab"
          style={{
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: 999,
            background: "var(--raised)",
            color: "var(--accent-strong)",
          }}
        >
          {copy.pitchFrom.replace("{price}", String(SOLO_PRICE))}
        </span>
      </div>

      <Button onClick={() => router.push("/pricing")}>{copy.pitchAction}</Button>
    </div>
  );
};

const DISMISSED_KEY = "tor-now.owner-pitch-dismissed";

/**
 * The search screen's: the question first, and a way to be rid of it.
 *
 * ponytail: the dismissal is device-local, like the favourites beside it. It
 * belongs on the User the day somebody asks why it came back on their tablet.
 */
export const DismissableOwnerPitch = () => {
  const copy = useCopy("customer");
  const router = useRouter();
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY) !== null;
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Without storage it simply comes back on the next visit.
    }
  };

  return (
    <div className="fade-in" style={{ ...GROUND, gap: 12, padding: 16, borderRadius: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <span style={{ ...MARK, width: 38, height: 38 }}>
          <BuildingIcon />
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ fontSize: 16 }}>{copy.pitchTitle}</h2>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
            {copy.pitchBody}
          </p>
        </span>
        {/* The same control the weekly hours use to drop a range, so hiding
            this reads as the app's own gesture rather than closing an ad. */}
        <button
          onClick={dismiss}
          aria-label={copy.pitchDismiss}
          style={{
            flexShrink: 0,
            width: 38,
            height: 38,
            marginBlockStart: -7,
            marginInlineEnd: -7,
            color: "var(--muted)",
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <Button onClick={() => router.push("/pricing")}>{copy.pitchAction}</Button>
      <span style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
        {copy.pitchFootnote}
      </span>
    </div>
  );
};
