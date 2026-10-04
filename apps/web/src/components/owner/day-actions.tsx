"use client";

import { useCopy } from "@/lib/i18n/index.tsx";
import { Button, Note, Sheet } from "../ui.tsx";
import { clockOf, holdsAnAppointment, spokenLength } from "./day-model.ts";
import type { Picked } from "./day-timeline.tsx";

/**
 * What a tap on a free stretch of the timeline opens.
 *
 * The rule the whole screen rests on is that a tap only ever opens — nothing on
 * a surface people scroll past changes the day by itself. A free stretch is
 * overwhelmingly for filling, so booking leads; the other thing it can become
 * is a change to the calendar, which opens the same complete sheet every other
 * door opens, with this stretch's day, calendar and hours already in it.
 */

export const DayActionSheet = ({
  picked,
  past,
  minutesNow,
  durations,
  onClose,
  onBook,
  onChange,
}: {
  /** Only a free stretch opens here; an appointment and a change have sheets of their own. */
  picked: Extract<Picked, { kind: "free" }> | null;
  /** Whether the day being read has already been and gone. */
  past: boolean;
  /** The clock now on the day being read, so an hour already gone is not offered. */
  minutesNow: number;
  /** How long each service on offer takes; null until known. */
  durations: readonly number[] | null;
  onClose: () => void;
  /**
   * Start booking somebody into this stretch.
   *
   * Handed up rather than opening a sheet from inside a sheet: the booking
   * sheet belongs to the screen, which is also what knows how to ask everything
   * again once an appointment exists.
   */
  onBook: (span: { start: number; end: number }, resourceId: string) => void;
  /** "שינוי ביומן" for this stretch: the screen opens the full sheet, filled in. */
  onChange: (span: { start: number; end: number }, resourceId: string) => void;
}) => {
  const copy = useCopy("owner");
  const changeCopy = useCopy("change");
  const words = {
    hour: copy.oneHour,
    twoHours: copy.twoHours,
    hours: copy.manyHours,
    andHalf: copy.andHalf,
    minutes: copy.minutesShort,
  };

  return (
    <Sheet open={picked !== null} onClose={onClose}>
      {picked !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ flex: 1, fontSize: 18 }} className="tab">
              {clockOf(picked.start)}–{clockOf(picked.end)}
            </h2>
            <span className="badge">{spokenLength(picked.end - picked.start, words)}</span>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {picked.resourceName}
          </p>

          {past || picked.end <= minutesNow ? (
            <Note>{copy.alreadyPassed}</Note>
          ) : (
            <>
              {/* Booking only where an appointment fits: offering it in a gap
                  shorter than every service offered something that cannot be done. */}
              {holdsAnAppointment(picked.end - picked.start, durations) && (
                <Button onClick={() => onBook({ start: picked.start, end: picked.end }, picked.resourceId)}>
                  {changeCopy.bookHere}
                </Button>
              )}
              <Button
                intent={holdsAnAppointment(picked.end - picked.start, durations) ? "quiet" : "primary"}
                onClick={() => onChange({ start: picked.start, end: picked.end }, picked.resourceId)}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span>{changeCopy.title}</span>
                  <small className="hint">{changeCopy.stretchHint}</small>
                </span>
              </Button>
              {!holdsAnAppointment(picked.end - picked.start, durations) && durations !== null && durations.length > 0 && (
                <Note>{copy.tooShortToBook.replace("{minutes}", String(Math.min(...durations)))}</Note>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
};

/**
 * The clock now, in the business's own zone, as minutes — or the end of the day
 * when the date being read is not today, so a past day is past all over.
 */
export const minutesNowOn = (timeZone: string, date: string): number => {
  const now = new Date();
  const here = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (here !== date) return here > date ? 24 * 60 : 0;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};
