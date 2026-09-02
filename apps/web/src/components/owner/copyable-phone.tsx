"use client";

import { useState } from "react";

/**
 * A customer's phone number, ready to be used rather than merely read.
 *
 * A business looking at this has one of two things in mind: ring them, or paste
 * the number somewhere else. Both were a transcription job — read it off the
 * screen, type it into the phone, hope. So the number is a call link and the
 * button beside it copies.
 */
export const CopyablePhone = ({
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
      <a
        href={`tel:${phone}`}
        className="tab"
        dir="ltr"
        aria-label={`${labels.call} ${phone}`}
        style={{ flex: 1, fontSize: 15, textAlign: "start" }}
      >
        {phone}
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={labels.copy}
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
        aria-label={labels.call}
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
