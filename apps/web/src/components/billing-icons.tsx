import type { ReactNode } from "react";

/**
 * The small line icons Billing draws with: a Notice's kind, and where a
 * Feature comes from. One set, so a gift means a Grant wherever it appears.
 */
export const iconSvg = (children: ReactNode, size = 17) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {children}
  </svg>
);

export const BILLING_ICONS = {
  clock: iconSvg(
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
  ),
  alert: iconSvg(
    <>
      <path d="M12 4l9 16H3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4M12 17.2v.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
  ),
  swap: iconSvg(
    <path
      d="M5 8h13l-3-3M19 16H6l3 3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  ),
  lock: iconSvg(
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </>,
  ),
  check: iconSvg(
    <path d="M5 12l5 5 9-10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  ),
  pause: iconSvg(<path d="M9 6v12M15 6v12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />),
  gift: iconSvg(
    <path
      d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    />,
  ),
  /** An Add-on: bought on its own, paid for each month. */
  coin: iconSvg(
    <>
      <ellipse cx="12" cy="6.5" rx="7" ry="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 6.5v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"
        stroke="currentColor"
        strokeWidth="2"
      />
    </>,
  ),
  plus: iconSvg(<path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />),
  spark: iconSvg(
    <path
      d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />,
  ),
};

