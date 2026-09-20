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
  onWaitFor,
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
    /** "{part} — tell me if something opens". ADR 0018. */
    waitForPart: string;
    waitForDay: string;
  };
  businessPhone: string;
  /**
   * ADR 0018. Offered where the customer has just discovered there is nothing
   * — the whole day, or one part of it — and left out entirely when the caller
   * has no waiting list to offer.
   */
  onWaitFor?: ((part: PartOfDay | null) => void) | undefined;
}) => {
  const { language } = useLanguage();

  if (day.slots.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
        {/* The highest-intent moment in the product: somebody wanted a time
            and could not have one. Not offered when the day is closed or
            beyond the horizon — there is nothing there to free up. */}
        {onWaitFor !== undefined && day.emptyReason === "FULLY_BOOKED" && (
          <WaitButton label={labels.waitForDay} onClick={() => onWaitFor(null)} />
        )}
      </div>
    );
  }

  const grouped = ORDER.map((part) => ({
    part,
    slots: day.slots.filter((slot) => partOfDay(slot.startAt, timeZone) === part),
  }))
    // A part with nothing in it is kept only when there is something to offer
    // there: somebody who wants a morning should find the morning, and find it
    // saying it is empty, rather than not find it at all.
    .filter((group) => group.slots.length > 0 || onWaitFor !== undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {grouped.map((group) => (
        <div key={group.part} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="label">{labels[group.part]}</span>
          {group.slots.length === 0 && onWaitFor !== undefined && (
            <WaitButton
              label={labels.waitForPart.replace("{part}", labels[group.part])}
              onClick={() => onWaitFor(group.part)}
            />
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 8,
            }}
            role="radiogroup"
            aria-label={labels[group.part]}
            hidden={group.slots.length === 0}
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

/**
 * The offer to be told, where somebody has just found nothing.
 *
 * Quiet on purpose: it is the second-best answer on the screen, and it sits
 * where the times would have been. A button that shouted would read as the
 * thing to do rather than as what is left when the thing to do is unavailable.
 */
const WaitButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      minHeight: 44,
      padding: "0 14px",
      borderRadius: 13,
      border: "1px solid color-mix(in oklab, var(--caution) 30%, transparent)",
      background: "var(--caution-soft)",
      color: "var(--caution)",
      fontSize: 14,
      fontWeight: 600,
      gap: 7,
    }}
  >
    <BellIcon />
    {label}
  </button>
);

const BellIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M13.7 21a2 2 0 01-3.4 0"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
