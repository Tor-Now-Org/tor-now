"use client";

import { formatLocalDate } from "@/lib/format.ts";
import type { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Button, Card } from "../ui.tsx";
import { RenameNote } from "./rename-note.tsx";

/**
 * A day the shop is closed on.
 *
 * It used to draw as an ordinary timeline: an empty day, its hours free and
 * every stretch of them inviting a blockage or an appointment. That is the
 * opposite of what the day is, and nothing on the screen said otherwise — the
 * only clue was the month square, one scroll up.
 *
 * So the day says it, in the words it was closed with, and offers the way back
 * out to whoever may take it.
 */
export const ClosedDay = ({
  note,
  date,
  copy,
  language,
  mayReopen,
  busy,
  onReopen,
  onDescribe,
}: {
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
      🏪
    </span>
    <b style={{ fontSize: 17, color: "var(--closed)" }}>{copy.closedAllDay}</b>
    <span className="hint">
      {formatLocalDate(date, language, { weekday: "long", day: "numeric", month: "long" })}
    </span>
    {note !== null && note.trim() !== "" && (
      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{note}</p>
    )}
    {/* The words are half of why a day is shut, and this is where somebody
        looking at that day is standing. Saying them here saves a trip up to
        the band in the month to find out, or to put them right. */}
    {mayReopen && (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <RenameNote note={note} busy={busy} onSave={onDescribe} />
        <Button intent="quiet" busy={busy} onClick={onReopen}>
          {copy.reopenOneDay}
        </Button>
      </div>
    )}
  </Card>
);
