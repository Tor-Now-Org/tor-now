"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Field, Note, Sheet } from "../ui.tsx";
import { clockOf, minutesOf, spokenLength } from "./day-model.ts";
import { RenameNote } from "./rename-note.tsx";
import type { Picked } from "./day-timeline.tsx";

/**
 * What a tap on the timeline opens.
 *
 * The rule the whole screen rests on is that a tap only ever opens — nothing on
 * a surface people scroll past changes the day by itself. So this sheet is
 * where every change lives, and it offers only what the moment allows: ten
 * minutes cannot hold the shortest service and says so, and an hour that has
 * already gone is not worth blocking.
 *
 * A blockage that belongs to a longer one says which day of how many it is, and
 * offers both ways out by name rather than making the owner guess which button
 * takes the holiday with it.
 */

/** Nothing shorter than this can hold an appointment, whatever the service. */
const SHORTEST_SERVICE_MINUTES = 15;

export const DayActionSheet = ({
  picked,
  token,
  business,
  date,
  past,
  onClose,
  onChanged,
}: {
  picked: Picked | null;
  token: string;
  business: BusinessDto;
  date: string;
  /** Whether the day being read has already been and gone. */
  past: boolean;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const copy = useCopy("owner");
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<number | null>(null);

  const words = {
    hour: copy.oneHour,
    twoHours: copy.twoHours,
    hours: copy.manyHours,
    andHalf: copy.andHalf,
    minutes: copy.minutesShort,
  };

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setGroup(null);
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  /** How many days the blockage under the finger covers, once it is known. */
  const openBlock = async (groupId: string) => {
    try {
      const blocks = await api.blockGroup(token, business.id, groupId);
      setGroup(blocks.length);
    } catch {
      setGroup(1);
    }
  };

  return (
    <Sheet
      open={picked !== null}
      onClose={() => {
        setGroup(null);
        setError(null);
        onClose();
      }}
    >
      {picked !== null && picked.kind === "free" && (
        <FreeActions
          picked={picked}
          words={words}
          copy={copy}
          busy={busy}
          error={error}
          past={past || picked.end <= minutesNow(business.timeZone, date)}
          onBlock={(span, note) =>
            void act(() =>
              api.createBlocks(token, business.id, picked.resourceId, [
                {
                  startAt: instantOf(date, span.start, business.timeZone),
                  endAt: instantOf(date, span.end, business.timeZone),
                  reason: note.trim(),
                },
              ]),
            )
          }
        />
      )}

      {picked !== null && picked.kind === "block" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{picked.reason || copy.blockedWord}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {clockOf(picked.start)}–{clockOf(picked.end)} · {picked.resourceName}
          </p>

          {picked.groupId !== null && group === null && (
            <Button intent="quiet" onClick={() => void openBlock(picked.groupId ?? "")}>
              {copy.whatHappens}
            </Button>
          )}
          {group !== null && group > 1 && (
            <p className="said" style={{ margin: 0 }}>
              {copy.partOfBlockage.replace("{days}", String(group))}
            </p>
          )}

          {picked.groupId !== null && (
            <RenameNote
              note={picked.reason}
              busy={busy}
              onSave={(said) =>
                void act(() =>
                  api.renameBlockGroup(token, business.id, picked.groupId ?? "", said),
                )
              }
            />
          )}

          {error !== null && <Critical>{error}</Critical>}

          <Button
            intent="danger"
            busy={busy}
            onClick={() => void act(() => api.deleteBlock(token, business.id, picked.id))}
          >
            {group !== null && group > 1 ? copy.removeThisDayOnly : copy.delete}
          </Button>
          {picked.groupId !== null && group !== null && group > 1 && (
            <Button
              intent="danger"
              busy={busy}
              onClick={() =>
                void act(() =>
                  api.deleteBlockGroup(token, business.id, picked.groupId ?? ""),
                )
              }
            >
              {copy.removeWholeBlockage.replace("{days}", String(group))}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
};

const FreeActions = ({
  picked,
  words,
  copy,
  busy,
  error,
  past,
  onBlock,
}: {
  picked: Extract<Picked, { kind: "free" }>;
  words: Parameters<typeof spokenLength>[1];
  copy: ReturnType<typeof useCopy<"owner">>;
  busy: boolean;
  error: string | null;
  past: boolean;
  onBlock: (span: { start: number; end: number }, note: string) => void;
}) => {
  /**
   * Which part of the free stretch this is about.
   *
   * A whole quiet afternoon is one tap on the timeline, and almost nobody means
   * "block all five hours" — they mean the hour they are about to spend
   * elsewhere. So the stretch arrives as the default and the two times are
   * there to narrow it, with the ordinary lengths one tap away.
   */
  const [from, setFrom] = useState(clockOf(picked.start));
  const [until, setUntil] = useState(clockOf(picked.end));
  /**
   * Why, in the owner's words — and optional, because most of the time there
   * is no why worth typing. When it is there it is what the calendar says
   * afterwards, which beats a month of squares all reading "blocked".
   */
  const [note, setNote] = useState("");

  // A different stretch was tapped: start again from the whole of it.
  const [about, setAbout] = useState(`${picked.start}-${picked.end}`);
  if (about !== `${picked.start}-${picked.end}`) {
    setAbout(`${picked.start}-${picked.end}`);
    setFrom(clockOf(picked.start));
    setUntil(clockOf(picked.end));
    setNote("");
  }

  const whole = picked.end - picked.start;
  const chosen = { start: minutesOf(from), end: minutesOf(until) };
  const length = chosen.end - chosen.start;
  const usable = length > 0;
  const tooShort = whole < SHORTEST_SERVICE_MINUTES;

  const take = (minutes: number) => {
    setFrom(clockOf(picked.start));
    setUntil(clockOf(Math.min(picked.start + minutes, picked.end)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h2 style={{ flex: 1, fontSize: 18 }} className="tab">
          {clockOf(picked.start)}–{clockOf(picked.end)}
        </h2>
        <span className="badge">{spokenLength(whole, words)}</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {picked.resourceName}
      </p>

      {past ? (
        <Note>{copy.alreadyPassed}</Note>
      ) : (
        <>
          {/* Only worth asking when there is a choice to make: a twenty-minute
              gap is the whole of itself. */}
          {whole > SHORTEST_SERVICE_MINUTES * 2 && (
            <>
              <span className="label">{copy.whichHours}</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field
                  id="free-from"
                  label={copy.from}
                  type="time"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
                <Field
                  id="free-to"
                  label={copy.to}
                  type="time"
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[30, 60, 120]
                  .filter((minutes) => minutes < whole)
                  .map((minutes) => (
                    <button
                      key={minutes}
                      className="chip tap"
                      onClick={() => take(minutes)}
                      style={{ minHeight: 34, padding: "0 12px" }}
                    >
                      {spokenLength(minutes, words)}
                    </button>
                  ))}
                <button
                  className="chip tap"
                  onClick={() => {
                    setFrom(clockOf(picked.start));
                    setUntil(clockOf(picked.end));
                  }}
                  style={{ minHeight: 34, padding: "0 12px" }}
                >
                  {copy.wholeStretch}
                </button>
              </div>
            </>
          )}

          <Field
            id="free-note"
            label={copy.noteOptional}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.notePlaceholder}
          />

          {!usable && <Note>{copy.rangeInvalid}</Note>}
          {tooShort && (
            <Note>
              {copy.tooShortToBook.replace("{minutes}", String(SHORTEST_SERVICE_MINUTES))}
            </Note>
          )}
        </>
      )}

      {error !== null && <Critical>{error}</Critical>}

      <Button busy={busy} disabled={past || !usable} onClick={() => onBlock(chosen, note)}>
        {copy.blockThese.replace("{hours}", `${from}–${until}`)}
      </Button>
      {/* Booking somebody in from here is the obvious third thing to want, and
          it is the one thing the API cannot yet do: every route books as the
          caller, so there is no way to book on a customer's behalf. Shown and
          disabled rather than hidden — the gap is the answer to "why can I not
          do this here", and hiding it just makes the screen look finished. */}
      <Button intent="quiet" disabled title={copy.notYet}>
        {copy.addAppointmentTitle}
      </Button>
      <span className="hint">{copy.bookForCustomerSoon}</span>
    </div>
  );
};

/**
 * The clock now, in the business's own zone, as minutes — or the end of the day
 * when the date being read is not today, so a past day is past all over.
 */
const minutesNow = (timeZone: string, date: string): number => {
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

/** A wall clock on this date, as the instant the API stores. */
const instantOf = (date: string, minutes: number, timeZone: string): string => {
  const clock = clockOf(minutes);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = clock.split(":").map(Number) as [number, number];
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetAt(asIfUtc, timeZone);
  return new Date(asIfUtc - offsetAt(asIfUtc - offset, timeZone)).toISOString();
};

const offsetAt = (instant: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (
    Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second"),
    ) - instant
  );
};
