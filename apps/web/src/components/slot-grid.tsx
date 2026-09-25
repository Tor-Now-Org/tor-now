"use client";

import { partOfDay, timeIn, todayIn, type PartOfDay } from "@/lib/format.ts";
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
  waitingFor,
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
    /** And what it says once they are on the list. */
    waitingForPart: string;
    waitingForDay: string;
  };
  businessPhone: string;
  /**
   * ADR 0018. Offered where the customer has just discovered there is nothing
   * — the whole day, or one part of it — and left out entirely when the caller
   * has no waiting list to offer.
   */
  onWaitFor?: ((part: PartOfDay | null) => void) | undefined;
  /**
   * Which parts of this day the customer is already waiting for. A button that
   * still says "tell me" after they have been told we will is the screen
   * forgetting what it was just asked — and the second press is somebody
   * checking whether the first one worked.
   */
  waitingFor?: readonly PartOfDay[] | undefined;
}) => {
  const { language } = useLanguage();
  const waiting = waitingFor ?? [];

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
          <WaitButton
            waiting={waiting.length > 0}
            // Which parts, unless it is all of them: somebody waiting only for
            // a morning is not waiting for "this day", and a button that says
            // so is a button that will be believed.
            label={
              waiting.length === 0
                ? labels.waitForDay
                : waiting.length === ORDER.length
                  ? labels.waitingForDay
                  : labels.waitingForPart.replace(
                      "{part}",
                      ORDER.filter((part) => waiting.includes(part))
                        .map((part) => labels[part])
                        .join(" · "),
                    )
            }
            onClick={() => onWaitFor(null)}
          />
        )}
      </div>
    );
  }

  // A part of today that is already over has nothing left to free up.
  const firstOpenPart =
    day.date === todayIn(timeZone)
      ? ORDER.indexOf(partOfDay(new Date().toISOString(), timeZone))
      : 0;

  const grouped = ORDER.map((part) => ({
    part,
    slots: day.slots.filter((slot) => partOfDay(slot.startAt, timeZone) === part),
  }))
    // A part with nothing in it is kept only when there is something to offer
    // there: somebody who wants a morning should find the morning, and find it
    // saying it is empty, rather than not find it at all.
    .filter(
      (group, index) =>
        group.slots.length > 0 || (onWaitFor !== undefined && index >= firstOpenPart),
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {grouped.map((group) => (
        <div key={group.part} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span className="label">{labels[group.part]}</span>
          {group.slots.length === 0 && onWaitFor !== undefined && (
            <WaitButton
              waiting={waiting.includes(group.part)}
              label={(waiting.includes(group.part)
                ? labels.waitingForPart
                : labels.waitForPart
              ).replace("{part}", labels[group.part])}
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
const WaitButton = ({
  label,
  waiting,
  onClick,
}: {
  label: string;
  waiting: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    aria-pressed={waiting}
    style={{
      minHeight: 44,
      padding: "0 14px",
      borderRadius: 13,
      // Settled rather than offered, once they are on the list: the same
      // control, saying what is true now, and still the way back in to change
      // it or leave.
      border: `1px solid color-mix(in oklab, var(--${waiting ? "positive" : "caution"}) 30%, transparent)`,
      background: `var(--${waiting ? "positive" : "caution"}-soft)`,
      color: `var(--${waiting ? "positive" : "caution"})`,
      fontSize: 14,
      fontWeight: 600,
      gap: 7,
    }}
  >
    {waiting ? <TickIcon /> : <BellIcon />}
    {label}
  </button>
);

const TickIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 6L9 17l-5-5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
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
