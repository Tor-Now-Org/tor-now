"use client";

import { partOfDay, timeIn, type PartOfDay } from "@/lib/format.ts";
import { useLanguage } from "@/lib/i18n/index.tsx";
import type { DayAvailabilityDto, SlotDto } from "@/lib/api/types.ts";
import { Empty } from "./ui.tsx";

/**
 * The start times a customer chooses from, grouped into parts of the day. The
 * groups are presentation only — the engine produced a flat list, and ADR 0001
 * warns those times drift off round numbers as a day fills up, so the grid must
 * not assume a rhythm it does not have.
 */
const ORDER: readonly PartOfDay[] = ["morning", "noon", "evening"];

export const SlotGrid = ({
  day,
  timeZone,
  selected,
  onSelect,
  labels,
  businessPhone,
}: {
  day: DayAvailabilityDto;
  timeZone: string;
  selected: string | null;
  onSelect: (slot: SlotDto) => void;
  labels: {
    morning: string;
    noon: string;
    evening: string;
    noTimes: string;
    noTimesBody: string;
    callBusiness: string;
  };
  businessPhone: string;
}) => {
  const { language } = useLanguage();

  if (day.slots.length === 0) {
    return (
      <Empty
        title={labels.noTimes}
        body={labels.noTimesBody}
        action={
          // ADR 0012: when the minimum notice is what emptied the day, the
          // customer is told how to ask rather than merely told no.
          day.emptyReason === "TOO_SOON" ? (
            <a href={`tel:${businessPhone}`} className="quiet" style={{ width: "auto", padding: "0 22px" }}>
              {labels.callBusiness}
            </a>
          ) : undefined
        }
      />
    );
  }

  const grouped = ORDER.map((part) => ({
    part,
    slots: day.slots.filter((slot) => partOfDay(slot.startAt, timeZone) === part),
  })).filter((group) => group.slots.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {grouped.map((group) => (
        <div key={group.part} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="label">{labels[group.part]}</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 8,
            }}
            role="radiogroup"
            aria-label={labels[group.part]}
          >
            {group.slots.map((slot) => {
              const active = slot.startAt === selected;
              return (
                <button
                  key={slot.startAt}
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelect(slot)}
                  className="tab"
                  style={{
                    minHeight: 46,
                    borderRadius: 13,
                    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                    background: active ? "var(--accent)" : "var(--raised)",
                    color: active ? "var(--on-accent)" : "var(--ink)",
                    fontSize: 15,
                    fontWeight: 500,
                  }}
                >
                  {timeIn(slot.startAt, timeZone, language)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
