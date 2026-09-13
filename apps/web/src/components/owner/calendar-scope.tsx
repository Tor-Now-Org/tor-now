"use client";

import { useState } from "react";
import type { ResourceDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Sheet } from "../ui.tsx";
import { laneColourOf } from "./event-colour.ts";

/**
 * Which calendar the screen is reading.
 *
 * A row of chips, one per calendar, sat above the month — another row of the
 * screen spent on a control, on a screen whose whole job is the calendar. A
 * shop with four chairs spent two rows on it once the names wrapped.
 *
 * So it says which one is being read, in that calendar's own colour, and opens
 * the list when asked. One chip on the toolbar instead of a row, and the thing
 * it is telling you — whose calendar this is — is the part left visible.
 *
 * Nothing at all where there is only one calendar: there is no choice to make.
 */
export const CalendarScope = ({
  resources,
  everyone,
  chosen,
  onEveryone,
  onChoose,
}: {
  resources: readonly ResourceDto[];
  /** Reading every calendar at once. */
  everyone: boolean;
  chosen: ResourceDto | null;
  onEveryone: () => void;
  onChoose: (resource: ResourceDto) => void;
}) => {
  const copy = useCopy("owner");
  const [open, setOpen] = useState(false);

  if (resources.length < 2) return null;

  const at = chosen === null ? -1 : resources.findIndex((one) => one.id === chosen.id);
  const said = everyone ? copy.allCalendars : (chosen?.name ?? "");

  return (
    <>
      <button
        className="chip tap"
        onClick={() => setOpen(true)}
        aria-label={`${copy.calendarsWord}: ${said}`}
        style={{
          minHeight: 34,
          gap: 5,
          paddingInline: 9,
          fontSize: 12,
          maxWidth: 108,
          overflow: "hidden",
        }}
      >
        <i
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            flexShrink: 0,
            background: everyone ? "var(--faint)" : laneColourOf(at),
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {said}
        </span>
        <span aria-hidden="true" style={{ color: "var(--faint)" }}>
          ▾
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 18 }}>{copy.calendarsWord}</h2>
          <Row
            colour="var(--faint)"
            label={copy.allCalendars}
            picked={everyone}
            onClick={() => {
              onEveryone();
              setOpen(false);
            }}
          />
          {resources.map((resource, index) => (
            <Row
              key={resource.id}
              colour={laneColourOf(index)}
              label={resource.name}
              picked={!everyone && resource.id === chosen?.id}
              onClick={() => {
                onChoose(resource);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
};

const Row = ({
  colour,
  label,
  picked,
  onClick,
}: {
  colour: string;
  label: string;
  picked: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    aria-pressed={picked}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "11px 12px",
      borderRadius: 11,
      border: `1px solid ${picked ? "var(--accent)" : "var(--line)"}`,
      background: picked ? "var(--accent-soft)" : "var(--raised)",
      color: picked ? "var(--accent-strong)" : "var(--ink)",
      textAlign: "start",
      width: "100%",
      fontWeight: picked ? 600 : 400,
    }}
  >
    <i
      aria-hidden="true"
      style={{ width: 10, height: 10, borderRadius: 999, flexShrink: 0, background: colour }}
    />
    <span style={{ flex: 1 }}>{label}</span>
    {picked && <span aria-hidden="true">✓</span>}
  </button>
);
