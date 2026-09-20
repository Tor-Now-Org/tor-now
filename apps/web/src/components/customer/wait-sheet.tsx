"use client";

import { useState } from "react";
import type { BusinessProfileDto, PartOfDayName, WaitingDto } from "@/lib/api/types.ts";
import { asWirePart, formatLocalDate, type PartOfDay } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Button, Sheet } from "../ui.tsx";
import { chosenAfterPressing, isAny } from "./choosing.ts";

/**
 * ADR 0018. What a customer is asking for, when a day has nothing to give.
 *
 * It arrives pre-answered: the Service, the date and the calendar all came
 * from the screen behind, and the part of the day from whichever empty group
 * the offer was pressed in. So the common case is open, confirm.
 *
 * Both rows of chips read the same way on purpose — which hours, and which
 * calendars, are the same kind of question — and both get their behaviour from
 * one place, which is where that behaviour is tested.
 */
const PARTS: readonly PartOfDay[] = ["morning", "noon", "evening"];

export const WaitSheet = ({
  open,
  business,
  serviceName,
  onDate,
  wantedPart,
  resourceId,
  /** The entry this customer already has for this day, if any. */
  existing,
  saving,
  onClose,
  onConfirm,
  onRemove,
}: {
  open: boolean;
  business: BusinessProfileDto;
  serviceName: string;
  onDate: string;
  /** The part whose empty group was pressed, or null for the whole day. */
  wantedPart: PartOfDay | null;
  /** Whoever the screen behind had chosen. */
  resourceId: string | null;
  existing: WaitingDto | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (wish: { parts: PartOfDayName[]; resourceIds: string[] }) => void;
  onRemove: () => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();

  const everyResource = business.resources.map((one) => one.id);
  /**
   * Where the sheet starts. An entry already on the list opens showing what it
   * asked for — the sheet is how it is changed, so it has to say what it
   * currently is. Otherwise it opens on whichever empty group was pressed.
   */
  const asKept = (): readonly PartOfDay[] =>
    existing !== null
      ? PARTS.filter((part) => existing.parts.includes(asWirePart(part)))
      : wantedPart === null
        ? PARTS
        : [wantedPart];
  const asKeptResources = (): readonly string[] =>
    existing !== null
      ? everyResource.filter((id) =>
          existing.resourceNames.includes(
            business.resources.find((one) => one.id === id)?.name ?? "",
          ),
        )
      : resourceId === null
        ? everyResource
        : [resourceId];

  const [parts, setParts] = useState<readonly PartOfDay[]>(asKept);
  const [resources, setResources] = useState<readonly string[]>(asKeptResources);
  /**
   * Re-opened on a different part, day or entry, it starts from that one
   * rather than from whatever was chosen last time.
   */
  const opening = `${onDate}|${wantedPart ?? "-"}|${resourceId ?? "-"}|${existing?.id ?? "-"}`;
  const [openedOn, setOpenedOn] = useState(opening);
  if (openedOn !== opening) {
    setOpenedOn(opening);
    setParts(asKept());
    setResources(asKeptResources());
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="wait-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 id="wait-title" style={{ fontSize: 18 }}>
            {existing === null ? copy.waitTitle : copy.waitEditTitle}
          </h2>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            {serviceName} · {formatLocalDate(onDate, language)}
          </p>
        </div>

        <Chips
          label={copy.waitWhichHours}
          anyLabel={copy.waitAnyHour}
          any={isAny(PARTS, parts)}
          onAny={() => setParts(PARTS)}
          options={PARTS.map((part) => ({
            key: part,
            name: copy[part],
            on: !isAny(PARTS, parts) && parts.includes(part),
            press: () => setParts(chosenAfterPressing(PARTS, parts, part)),
          }))}
        />

        {/* Only worth asking where there is more than one calendar to choose. */}
        {business.resources.length > 1 && (
          <Chips
            label={copy.waitWhichResource}
            anyLabel={copy.waitAnyResource}
            any={isAny(everyResource, resources)}
            onAny={() => setResources(everyResource)}
            options={business.resources.map((resource) => ({
              key: resource.id,
              name: resource.name,
              on: !isAny(everyResource, resources) && resources.includes(resource.id),
              press: () =>
                setResources(chosenAfterPressing(everyResource, resources, resource.id)),
            }))}
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
          {existing === null ? copy.waitConfirm : copy.waitSaveChanges}
        </Button>
        {existing !== null && (
          <Button intent="quiet" onClick={onRemove} busy={saving}>
            {copy.waitLeaveList}
          </Button>
        )}
        <p className="hint" style={{ margin: 0, textAlign: "center" }}>
          {copy.waitEndsBy}
        </p>
      </div>
    </Sheet>
  );
};

type Choice = { key: string; name: string; on: boolean; press: () => void };

/**
 * A row of chips with "any" at the end of it.
 *
 * "Any" is the state where everything is taken, not a fourth thing to take —
 * so exactly one of the two halves of this row is ever lit, and pressing a
 * named chip while "any" shows narrows to that one.
 */
const Chips = ({
  label,
  options,
  any,
  anyLabel,
  onAny,
}: {
  label: string;
  options: readonly Choice[];
  any: boolean;
  anyLabel: string;
  onAny: () => void;
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <span className="label">{label}</span>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {[
        ...options,
        { key: "any", name: anyLabel, on: any, press: onAny },
      ].map((option) => (
        <button
          key={option.key}
          aria-pressed={option.on}
          onClick={option.press}
          style={{
            minHeight: 42,
            padding: "0 16px",
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
