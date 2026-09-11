"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ResourceDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Field, Note, Sheet } from "../ui.tsx";

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
  onSheet,
  onAim,
}: {
  /** Out of the way while any sheet is up: a button under a sheet is a trap. */
  hidden: boolean;
  /** Told both ways, so the button comes back when the sheet is dismissed. */
  onSheet: (open: boolean) => void;
  onAim: (aim: Aim) => void;
}) => {
  const copy = useCopy("owner");
  const [open, setOpen] = useState(false);

  const shut = () => {
    setOpen(false);
    onSheet(false);
  };

  const choose = (aim: Aim) => {
    shut();
    onAim(aim);
  };

  return (
    <>
      {!hidden && !open && (
        <button
          onClick={() => {
            setOpen(true);
            onSheet(true);
          }}
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
          <Choice
            icon="🏪"
            title={copy.addSpecialTitle}
            hint={copy.addSpecialHint}
            onClick={() => choose("special")}
          />
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
  resources,
  resource,
  onClose,
  onDone,
}: {
  aim: Aim | null;
  dates: readonly string[];
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                    reason: copy.blockedWord,
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

          <Note>{copy.overrideReplaces}</Note>
          <p className="said" style={{ margin: 0 }}>
            {copy.willMake
              .replace("{days}", String(dates.length))
              .replace("{calendars}", copy.allCalendars)}
          </p>
          {error !== null && <Critical>{error}</Critical>}

          <Button
            busy={busy}
            disabled={!closedAllDay && until <= from}
            onClick={() =>
              void act(async () => {
                // The shop is every calendar: a special day the store keeps per
                // calendar, said once here.
                for (const one of resources) {
                  for (const date of dates) {
                    await api.putOverride(token, business.id, one.id, {
                      date,
                      note: null,
                      ranges: closedAllDay ? [] : [{ start: from, end: until }],
                    });
                  }
                }
              })
            }
          >
            {copy.save}
          </Button>
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
