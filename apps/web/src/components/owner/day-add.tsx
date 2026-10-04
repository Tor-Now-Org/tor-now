"use client";

import { useState } from "react";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Sheet } from "../ui.tsx";
import { useAnySheetOpen } from "../sheet-presence.ts";

/**
 * Adding something to the calendar, in the order a person decides it.
 *
 * What, then when, then the details. The + says what is being made; the grid
 * then asks which days, with the action named above it; and only at the end is
 * anything asked that depends on both. Doing it the other way round — every tap
 * on a day offering three things nobody had asked for — is what made the month
 * feel like a minefield.
 */

/** "שינוי ביומן" covers what blockages and special days were; an appointment is the other thing the + makes. */
export type Aim = "change" | "appointment";

export const AddButton = ({
  hidden,
  onAim,
}: {
  /** Out of the way while days are being chosen: the grid is the screen then. */
  hidden: boolean;
  onAim: (aim: Aim) => void;
}) => {
  const copy = useCopy("owner");
  const changeCopy = useCopy("change");
  const [open, setOpen] = useState(false);
  // Any sheet at all, not only this one: a button sitting on top of a dialog is
  // a trap, and the list of dialogs it had to know about kept growing.
  const covered = useAnySheetOpen();

  const shut = () => setOpen(false);

  const choose = (aim: Aim) => {
    shut();
    onAim(aim);
  };

  return (
    <>
      {!hidden && !covered && (
        <button
          onClick={() => setOpen(true)}
          aria-label={copy.addToDay}
          style={{
            position: "fixed",
            insetInlineStart: 18,
            bottom: 86,
            width: 52,
            height: 52,
            borderRadius: 999,
            background: "var(--accent)",
            color: "var(--on-accent)",
            fontSize: 26,
            zIndex: 40,
            boxShadow: "0 4px 16px -4px oklch(52% 0.123 245/.7)",
          }}
        >
          +
        </button>
      )}

      <Sheet open={open} onClose={shut}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.whatToAdd}</h2>
          {/* One way to change a day. Who it may be for — a worker's own
              calendars, or the whole business — is the sheet's question. */}
          <Choice
            icon="✎"
            title={changeCopy.title}
            hint={changeCopy.menuHint}
            onClick={() => choose("change")}
          />
          <Choice
            icon="📅"
            title={copy.addAppointmentTitle}
            hint={copy.addAppointmentHint}
            onClick={() => choose("appointment")}
          />
        </div>
      </Sheet>
    </>
  );
};

const Choice = ({
  icon,
  title,
  hint,
  onClick,
  disabled = false,
}: {
  icon: string;
  title: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: "flex",
      alignItems: "center",
      // Said, because the shared button style centres its contents: each row
      // then centred its own icon and words, so three rows of different
      // lengths put their icons in three different places.
      justifyContent: "flex-start",
      gap: 11,
      padding: 11,
      borderRadius: 13,
      border: "1px solid var(--line)",
      background: disabled ? "var(--sunken)" : "var(--raised)",
      opacity: disabled ? 0.55 : 1,
      textAlign: "start",
      width: "100%",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        fontSize: 17,
        // On the disabled row the tile would otherwise be the same grey as the
        // row behind it, and the icon would float loose.
        background: disabled ? "var(--raised)" : "var(--sunken)",
        flexShrink: 0,
      }}
    >
      {icon}
    </span>
    <span
      style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
    >
      <b style={{ fontSize: 14, fontWeight: 600 }}>{title}</b>
      <span className="hint">{hint}</span>
    </span>
  </button>
);
