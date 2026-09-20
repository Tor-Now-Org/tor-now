"use client";

import { useState } from "react";
import type { BusinessProfileDto, PartOfDayName } from "@/lib/api/types.ts";
import { asWirePart, type PartOfDay } from "@/lib/format.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Button, Sheet } from "../ui.tsx";

/**
 * ADR 0018. What a customer is asking for, when a day has nothing to give.
 *
 * One decision on the sheet, and it arrives pre-answered: the Service, the
 * date and the calendar all came from the screen behind, and the part of the
 * day comes from whichever empty group the offer was pressed in. So the common
 * case is open, confirm — and somebody who wants to widen it can, in one more
 * tap.
 *
 * Both rows of chips read the same way on purpose. Which hours and which
 * calendars are the same kind of question, so they should not be two different
 * controls to learn.
 */
const PARTS: readonly PartOfDay[] = ["morning", "noon", "evening"];

export const WaitSheet = ({
  open,
  business,
  serviceName,
  onDate,
  wantedPart,
  resourceId,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  business: BusinessProfileDto;
  serviceName: string;
  onDate: string;
  /** The part whose empty group was pressed, or null for the whole day. */
  wantedPart: PartOfDay | null;
  /** Whoever the screen behind had chosen. */
  resourceId: string | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (wish: { parts: PartOfDayName[]; resourceIds: string[] }) => void;
}) => {
  const copy = useCopy("customer");
  /**
   * Keyed by the opening, so re-opening the sheet on another part starts from
   * that part rather than from whatever was chosen last time.
   */
  const [parts, setParts] = useState<readonly PartOfDay[]>(
    wantedPart === null ? PARTS : [wantedPart],
  );
  const [resources, setResources] = useState<readonly string[]>(
    resourceId === null ? business.resources.map((one) => one.id) : [resourceId],
  );
  const [openedOn, setOpenedOn] = useState({ wantedPart, resourceId, onDate });
  if (
    openedOn.wantedPart !== wantedPart ||
    openedOn.resourceId !== resourceId ||
    openedOn.onDate !== onDate
  ) {
    setOpenedOn({ wantedPart, resourceId, onDate });
    setParts(wantedPart === null ? PARTS : [wantedPart]);
    setResources(resourceId === null ? business.resources.map((one) => one.id) : [resourceId]);
  }

  /**
   * Chips toggle, except that the last one cannot be turned off: an empty set
   * is not a question anybody can answer, and the domain refuses it. Pressing
   * the only remaining chip therefore does nothing rather than producing a
   * confirm button that silently fails.
   */
  const toggle = <T,>(held: readonly T[], value: T): readonly T[] =>
    held.includes(value)
      ? held.length === 1
        ? held
        : held.filter((one) => one !== value)
      : [...held, value];

  const everyPart = parts.length === PARTS.length;
  const everyResource = resources.length === business.resources.length;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="wait-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 id="wait-title" style={{ fontSize: 18 }}>
            {copy.waitTitle}
          </h2>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            {serviceName} · {onDate}
          </p>
        </div>

        <Chips
          label={copy.waitWhichHours}
          options={[
            ...PARTS.map((part) => ({
              key: part,
              name: copy[part],
              on: parts.includes(part) && !everyPart,
              press: () => setParts(toggle(parts, part)),
            })),
            {
              key: "any",
              name: copy.waitAnyHour,
              on: everyPart,
              press: () => setParts(PARTS),
            },
          ]}
        />

        {/* Only worth asking where there is more than one calendar to choose. */}
        {business.resources.length > 1 && (
          <Chips
            label={copy.waitWhichResource}
            options={[
              ...business.resources.map((resource) => ({
                key: resource.id,
                name: resource.name,
                on: resources.includes(resource.id) && !everyResource,
                press: () => setResources(toggle(resources, resource.id)),
              })),
              {
                key: "any",
                name: copy.waitAnyResource,
                on: everyResource,
                press: () => setResources(business.resources.map((one) => one.id)),
              },
            ]}
          />
        )}

        <div
          style={{
            borderRadius: 14,
            padding: "12px 14px",
            background: "var(--caution-soft)",
            border: "1px solid color-mix(in oklab, var(--caution) 26%, transparent)",
          }}
        >
          <b style={{ fontSize: 13, color: "var(--caution)" }}>{copy.waitHow}</b>
          <p className="hint" style={{ margin: "3px 0 0" }}>
            {copy.waitHowBody}
          </p>
        </div>

        <Button
          busy={saving}
          onClick={() =>
            onConfirm({
              parts: parts.map(asWirePart),
              resourceIds: [...resources],
            })
          }
        >
          {copy.waitConfirm}
        </Button>
        <p className="hint" style={{ margin: 0, textAlign: "center" }}>
          {copy.waitEndsBy}
        </p>
      </div>
    </Sheet>
  );
};

type Choice = { key: string; name: string; on: boolean; press: () => void };

const Chips = ({ label, options }: { label: string; options: readonly Choice[] }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <span className="label">{label}</span>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((option) => (
        <button
          key={option.key}
          aria-pressed={option.on}
          onClick={option.press}
          style={{
            minHeight: 40,
            padding: "0 15px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 500,
            border: `1px solid ${option.on ? "var(--accent)" : "var(--line)"}`,
            background: option.on ? "var(--accent)" : "var(--raised)",
            color: option.on ? "var(--on-accent)" : "var(--ink)",
          }}
        >
          {option.name}
        </button>
      ))}
    </div>
  </div>
);
