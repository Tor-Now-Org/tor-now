"use client";

import { useState } from "react";

/**
 * What one side does with the other's number: ring it, or take it somewhere
 * else. Both were a transcription job — read it off the screen, type it into
 * the phone, hope. It runs in both directions now: a business calling a
 * customer, and a customer calling a business.
 *
 * The number itself is shown once, above, by whichever screen this sits on.
 * Repeating it here to hang two buttons off it would say the same thing twice;
 * the buttons name it in their labels instead, where a screen reader wants it
 * and the layout does not.
 */
export const PhoneActions = ({
  phone,
  labels,
}: {
  phone: string;
  labels: { call: string; copy: string; copied: string };
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard — an insecure origin, a denied
      // permission — leaves the number selectable on screen, which is what a
      // person would fall back to anyway. Saying nothing is better than an
      // error about an action they can complete by hand.
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`${labels.copy} ${phone}`}
        className="chip"
        style={{
          border: "1px solid var(--line)",
          background: copied ? "var(--positive-soft)" : "var(--raised)",
          color: copied ? "var(--positive)" : "var(--muted)",
          fontSize: 12.5,
        }}
      >
        {copied ? labels.copied : labels.copy}
      </button>
      <a
        href={`tel:${phone}`}
        className="chip"
        aria-label={`${labels.call} ${phone}`}
        style={{
          border: "1px solid var(--line)",
          background: "var(--raised)",
          color: "var(--accent-strong)",
          fontSize: 12.5,
          textDecoration: "none",
        }}
      >
        {labels.call}
      </a>
    </div>
  );
};
