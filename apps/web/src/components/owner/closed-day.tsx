"use client";

import { formatLocalDate } from "@/lib/format.ts";
import type { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Button, Card } from "../ui.tsx";
import { RenameNote } from "./rename-note.tsx";

/**
 * A day nobody works, and why nobody works it.
 *
 * It used to draw as an ordinary timeline: an empty day, its hours free and
 * every stretch of them inviting a blockage or an appointment. That is the
 * opposite of what the day is, and nothing on the screen said otherwise — the
 * only clue was the month square, one scroll up.
 *
 * Two different days end up here, and telling them apart is the whole job.
 * A closure is a decision somebody made about a date: it has words on it, it
 * can be described, and it can be undone. A rest day is the shape of the usual
 * week — no decision was made about this Saturday in particular, so there is
 * nothing here to name and nothing here to undo. Offering those anyway is what
 * this screen used to do, and both controls quietly did nothing: describing
 * looked for a closure to put the words on and found none, and undoing looked
 * for a closure to remove and removed none. Neither said so.
 *
 * The way to change a rest day is to change the week, which is a different
 * screen, so this one says that instead of pretending.
 */
export const ClosedDay = ({
  decided,
  note,
  date,
  copy,
  language,
  mayReopen,
  busy,
  onReopen,
  onDescribe,
}: {
  /**
   * Whether a closure was decided for this date, as opposed to the weekday
   * simply not being worked. ADR 0002: an override is that decision, and its
   * absence is what leaves the week's own hours in charge.
   */
  decided: boolean;
  note: string | null;
  date: string;
  copy: ReturnType<typeof useCopy<"owner">>;
  language: ReturnType<typeof useLanguage>["language"];
  /** ADR 0016: the shop's days are not a worker's to give back, or to name. */
  mayReopen: boolean;
  busy: boolean;
  onReopen: () => void;
  onDescribe: (note: string) => void;
}) => (
  <Card
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      padding: "26px 18px",
      background: "var(--closed-soft)",
      border: "1px solid var(--closed)",
      textAlign: "center",
    }}
  >
    <span aria-hidden="true" style={{ fontSize: 26 }}>
      {decided ? "🏪" : "🗓️"}
    </span>
    <b style={{ fontSize: 17, color: "var(--closed)" }}>
      {decided ? copy.closedAllDay : copy.restDayAllDay}
    </b>
    <span className="hint">
      {formatLocalDate(date, language, { weekday: "long", day: "numeric", month: "long" })}
    </span>
    {decided && note !== null && note.trim() !== "" && (
      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{note}</p>
    )}
    {!decided && <p className="hint" style={{ margin: 0 }}>{copy.restDayNote}</p>}
    {/* The words are half of why a day is shut, and this is where somebody
        looking at that day is standing. Saying them here saves a trip up to
        the band in the month to find out, or to put them right. Only for a
        closure, though: there is no decision behind a rest day to name or undo.
        See the note on this component. */}
    {decided && mayReopen && (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <RenameNote note={note} busy={busy} onSave={onDescribe} />
        <Button intent="quiet" busy={busy} onClick={onReopen}>
          {copy.reopenClosedDay}
        </Button>
      </div>
    )}
  </Card>
);
