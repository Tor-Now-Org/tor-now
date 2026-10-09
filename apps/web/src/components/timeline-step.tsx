import type { ReactNode } from "react";

/**
 * One step of what happens next, on the screens that end a flow: a booking
 * made, a business opened. Done is a filled tick; still to come is an empty
 * ring; due is an amber ring, for the one step that has a deadline on it.
 */
export type StepState = "done" | "todo" | "due";

export const Tick = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RING: Readonly<Record<StepState, { border: string; fill: string }>> = {
  done: { border: "var(--positive)", fill: "var(--positive)" },
  todo: { border: "var(--line)", fill: "var(--raised)" },
  due: { border: "var(--caution)", fill: "var(--caution-soft)" },
};

export const TimelineStep = ({
  state,
  title,
  detail,
  last = false,
  children,
}: {
  state: StepState;
  title: string;
  detail: string;
  last?: boolean;
  children?: ReactNode;
}) => (
  <li data-state={state} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, position: "relative", paddingBottom: last ? 0 : 14 }}>
    {!last && (
      <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 10, top: 22, bottom: 0, width: 2, background: "var(--line)" }} />
    )}
    <span
      style={{
        width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center",
        border: `2px solid ${RING[state].border}`,
        background: RING[state].fill,
      }}
    >
      {state === "done" && <Tick />}
    </span>
    <div>
      <b style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{title}</b>
      <span className="hint" style={{ fontSize: 12.5, display: "block" }}>{detail}</span>
      {children}
    </div>
  </li>
);
