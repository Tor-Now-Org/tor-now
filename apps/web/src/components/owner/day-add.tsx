"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ClosureImpactDto, ResourceDto } from "@/lib/api/types.ts";
import { formatLocalDate, whenIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Field, Note, Sheet } from "../ui.tsx";
import { useAnySheetOpen } from "../sheet-presence.ts";

/**
 * Adding something to the calendar, in the order a person decides it.
 *
 * What, then when, then the details. The + says what is being made; the grid
 * then asks which days, with the action named above it; and only at the end is
 * anything asked that depends on both. Doing it the other way round — every tap
 * on a day offering three things nobody had asked for — is what made the month
 * feel like a minefield.
 */

export type Aim = "block" | "special";

export const AddButton = ({
  hidden,
  onAim,
  canCloseBusiness,
}: {
  /** Out of the way while days are being chosen: the grid is the screen then. */
  hidden: boolean;
  onAim: (aim: Aim) => void;
  /** ADR 0016: shutting the shop is not a worker's to offer. */
  canCloseBusiness: boolean;
}) => {
  const copy = useCopy("owner");
  const [open, setOpen] = useState(false);
  // Any sheet at all, not only this one: a button sitting on top of a dialog is
  // a trap, and the list of dialogs it had to know about kept growing.
  const covered = useAnySheetOpen();

  const shut = () => setOpen(false);

  const choose = (aim: Aim) => {
    shut();
    onAim(aim);
  };

  return (
    <>
      {!hidden && !covered && (
        <button
          onClick={() => setOpen(true)}
          aria-label={copy.addToDay}
          style={{
            position: "fixed",
            insetInlineStart: 18,
            bottom: 86,
            width: 52,
            height: 52,
            borderRadius: 999,
            background: "var(--accent)",
            color: "var(--on-accent)",
            fontSize: 26,
            zIndex: 40,
            boxShadow: "0 4px 16px -4px oklch(52% 0.123 245/.7)",
          }}
        >
          +
        </button>
      )}

      <Sheet open={open} onClose={shut}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.whatToAdd}</h2>
          <Choice
            icon="⛔"
            title={copy.addBlockTitle}
            hint={copy.addBlockAimHint}
            onClick={() => choose("block")}
          />
          {/* The shop's own days. A worker keeps their calendar; whether the
              business opens on Sunday is not theirs to answer. */}
          {canCloseBusiness && (
            <Choice
              icon="🏪"
              title={copy.addSpecialTitle}
              hint={copy.addSpecialHint}
              onClick={() => choose("special")}
            />
          )}
          <Choice
            icon="📅"
            title={copy.addAppointmentTitle}
            hint={copy.addAppointmentHint}
            disabled
          />
        </div>
      </Sheet>
    </>
  );
};

/**
 * The last step: the details that depend on both the action and the days, and
 * a confirmation that says what is about to be made before it is.
 */
export const FinishAim = ({
  aim,
  dates,
  token,
  business,
  resource,
  onClose,
  onDone,
}: {
  aim: Aim | null;
  dates: readonly string[];
  token: string;
  business: BusinessDto;
  /** The calendar being read, which is what a blockage belongs to. */
  resource: ResourceDto | null;
  onClose: () => void;
  onDone: () => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [from, setFrom] = useState("12:00");
  const [until, setUntil] = useState("13:00");
  const [allDay, setAllDay] = useState(true);
  const [closedAllDay, setClosedAllDay] = useState(true);
  /** Why. Optional, and what the calendar says afterwards when it is given. */
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Who is booked inside the days being closed.
   *
   * Read before anything is written, because closing a fortnight quietly calls
   * off everyone in it — the owner has to see them to decide, and the same
   * question is asked again on the way through so the warning and the act
   * cannot disagree.
   */
  const [impact, setImpact] = useState<ClosureImpactDto | null>(null);

  // Primitives, not freshly-built objects: the preview below depends on these,
  // and a new array every render would ask the server on every render.
  const fromDate = dates[0] ?? "";
  const toDate = dates[dates.length - 1] ?? "";
  const hoursOf = (): { start: string; end: string }[] =>
    closedAllDay ? [] : [{ start: from, end: until }];

  /** How many people the current plan would call off, once it is known. */
  const closing = impact?.appointments.length ?? 0;

  const close = (upcoming: "KEEP" | "CANCEL") =>
    api.closeBusiness(token, business.id, {
      fromDate,
      toDate,
      note: note.trim() === "" ? null : note.trim(),
      ranges: hoursOf(),
      upcoming,
    });

  useEffect(() => {
    if (aim !== "special" || fromDate === "") {
      setImpact(null);
      return;
    }
    // Hours that make no sense are not a question worth asking the server.
    if (!closedAllDay && until <= from) return;
    let current = true;
    api
      .previewClosure(token, business.id, {
        fromDate,
        toDate,
        ranges: closedAllDay ? [] : [{ start: from, end: until }],
      })
      .then((answer) => {
        if (current) setImpact(answer);
      })
      .catch(() => {
        // A warning that could not be fetched must not read as "nobody is
        // booked": null keeps the screen saying it does not know yet.
        if (current) setImpact(null);
      });
    return () => {
      current = false;
    };
  }, [aim, token, business.id, fromDate, toDate, closedAllDay, from, until]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const said =
    dates.length === 0
      ? ""
      : dates.length === 1
        ? formatLocalDate(dates[0] ?? "", language, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : `${formatLocalDate(dates[0] ?? "", language, {
            day: "numeric",
            month: "long",
          })} – ${formatLocalDate(dates[dates.length - 1] ?? "", language, {
            day: "numeric",
            month: "long",
          })}`;

  return (
    <Sheet open={aim !== null && dates.length > 0} onClose={onClose}>
      {aim === "block" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.addBlockTitle}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {said} · {resource?.name ?? ""}
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            {[true, false].map((whole) => (
              <button
                key={String(whole)}
                className="chip"
                aria-pressed={allDay === whole}
                onClick={() => setAllDay(whole)}
                style={{
                  flex: 1,
                  minHeight: 40,
                  background: allDay === whole ? "var(--accent)" : "var(--raised)",
                  color: allDay === whole ? "var(--on-accent)" : "var(--ink)",
                  border: "1px solid var(--line)",
                }}
              >
                {whole ? copy.allDay : copy.partOfDay}
              </button>
            ))}
          </div>

          {!allDay && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                id="aim-block-from"
                label={copy.from}
                type="time"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Field
                id="aim-block-to"
                label={copy.to}
                type="time"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}
          {!allDay && until <= from && <Note>{copy.rangeInvalid}</Note>}

          <Field
            id="aim-block-note"
            label={copy.noteOptional}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.notePlaceholder}
          />

          <p className="said" style={{ margin: 0 }}>
            {copy.willMake
              .replace("{days}", String(dates.length))
              .replace("{calendars}", resource?.name ?? "")}
          </p>
          {error !== null && <Critical>{error}</Critical>}

          <Button
            busy={busy}
            disabled={resource === null || (!allDay && until <= from)}
            onClick={() =>
              void act(() =>
                api.createBlocks(
                  token,
                  business.id,
                  resource?.id ?? "",
                  dates.map((date) => ({
                    startAt: instantOf(date, allDay ? "00:00" : from, business.timeZone),
                    endAt: instantOf(date, allDay ? "23:59" : until, business.timeZone),
                    reason: note.trim() === "" ? copy.blockedWord : note.trim(),
                  })),
                ),
              )
            }
          >
            {copy.save}
          </Button>
        </div>
      )}

      {aim === "special" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.addSpecialTitle}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {said} · {copy.allCalendars}
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            {[true, false].map((shut) => (
              <button
                key={String(shut)}
                className="chip"
                aria-pressed={closedAllDay === shut}
                onClick={() => setClosedAllDay(shut)}
                style={{
                  flex: 1,
                  minHeight: 40,
                  background: closedAllDay === shut ? "var(--accent)" : "var(--raised)",
                  color: closedAllDay === shut ? "var(--on-accent)" : "var(--ink)",
                  border: "1px solid var(--line)",
                }}
              >
                {shut ? copy.closedAllDay : copy.differentHours}
              </button>
            ))}
          </div>

          {!closedAllDay && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                id="aim-special-from"
                label={copy.from}
                type="time"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Field
                id="aim-special-to"
                label={copy.to}
                type="time"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}

          <Field
            id="aim-special-note"
            label={copy.noteOptional}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.notePlaceholder}
          />

          <Note>{copy.overrideReplaces}</Note>

          {/* Who this costs. Closing a fortnight calls off everybody in it, and
              a screen that does that without saying so is not one to trust —
              so the names come first and the button says what it will do. */}
          {impact !== null && impact.appointments.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Critical>
                {copy.closingWillCancel.replace(
                  "{count}",
                  String(impact.appointments.length),
                )}
              </Critical>
              <div
                className="scroll"
                style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190 }}
              >
                {impact.appointments.map((one) => (
                  <span
                    key={one.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 9px",
                      borderRadius: 10,
                      background: "var(--sunken)",
                      fontSize: 12,
                    }}
                  >
                    <span className="tab hint" style={{ width: 96 }}>
                      {whenIn(one.startAt, business.timeZone, language)}
                    </span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{one.customerName}</span>
                    <span className="hint">{one.serviceName}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {impact !== null && impact.appointments.length === 0 && (
            <p className="said" style={{ margin: 0 }}>
              {copy.nothingBookedThen}
            </p>
          )}

          <p className="said" style={{ margin: 0 }}>
            {copy.willMake
              .replace("{days}", String(dates.length))
              .replace("{calendars}", copy.allCalendars)}
          </p>
          {error !== null && <Critical>{error}</Critical>}

          {/* One call, not a loop over the calendars: the business closes, and
              the API writes every calendar and answers for every booking in one
              transaction. Looping here could only ever half-close a shop. */}
          <Button
            intent={closing > 0 ? "danger" : "primary"}
            busy={busy}
            disabled={!closedAllDay && until <= from}
            onClick={() => void act(() => close("CANCEL"))}
          >
            {closing > 0 ? copy.closeAndCancel.replace("{count}", String(closing)) : copy.save}
          </Button>
          {closing > 0 && (
            // Both answers are wrong by default, so both are offered and
            // neither is assumed: a shut shop with the appointments still on
            // the books is a real choice when the owner means to ring round.
            <Button
              intent="quiet"
              busy={busy}
              disabled={!closedAllDay && until <= from}
              onClick={() => void act(() => close("KEEP"))}
            >
              {copy.closeAndKeep}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
};

const Choice = ({
  icon,
  title,
  hint,
  onClick,
  disabled = false,
}: {
  icon: string;
  title: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: 11,
      borderRadius: 13,
      border: "1px solid var(--line)",
      background: disabled ? "var(--sunken)" : "var(--raised)",
      opacity: disabled ? 0.55 : 1,
      textAlign: "start",
      width: "100%",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        fontSize: 17,
        background: "var(--sunken)",
        flexShrink: 0,
      }}
    >
      {icon}
    </span>
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <b style={{ fontSize: 14, fontWeight: 600 }}>{title}</b>
      <span className="hint">{hint}</span>
    </span>
  </button>
);

/** A wall clock on this date, as the instant the API stores. */
const instantOf = (date: string, clock: string, timeZone: string): string => {
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
