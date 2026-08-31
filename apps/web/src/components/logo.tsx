/**
 * The mark and the wordmark from the canvas. The wordmark keeps its own
 * right-to-left composition whatever direction the interface is running in —
 * "תורNow" is a name, not a sentence to be mirrored.
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

export const Wordmark = ({ size = 19 }: { size?: number }) => (
  <span className="wordmark" style={{ fontSize: size }}>
    <span className="he">תור</span>
    <span className="now">Now</span>
  </span>
);

export const Logo = ({ size = 26 }: { size?: number }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
    <LogoMark size={size} />
    <Wordmark />
  </span>
);
