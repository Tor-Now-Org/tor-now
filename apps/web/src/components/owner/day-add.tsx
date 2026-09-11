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
 * The one button that adds to a day, and the three things it can add.
 *
 * They are said in the owner's words rather than the system's — an appointment
 * for a customer, an hour this calendar will not take, a day the whole shop
 * behaves differently — and each carries the day it is about, so "when" is
 * never asked twice.
 */

type Adding = "block" | "special" | null;

export const AddToDay = ({
  token,
  business,
  date,
  resources,
  resource,
  onChanged,
}: {
  token: string;
  business: BusinessDto;
  date: string;
  resources: readonly ResourceDto[];
  /** The calendar being read, which is what a blockage would belong to. */
  resource: ResourceDto | null;
  onChanged: () => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<Adding>(null);
  const [from, setFrom] = useState("12:00");
  const [until, setUntil] = useState("13:00");
  const [closedAllDay, setClosedAllDay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setAdding(null);
    setError(null);
  };

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      close();
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const said = formatLocalDate(date, language, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
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

      {/* What to add. Nothing is asked for until one is chosen. */}
      <Sheet open={open && adding === null} onClose={close}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.addToDayTitle.replace("{day}", said)}</h2>

          <Choice
            icon="⛔"
            title={copy.addBlockTitle}
            hint={
              resource === null
                ? copy.pickACalendar
                : copy.addBlockHint.replace("{calendar}", resource.name)
            }
            onClick={() => setAdding("block")}
          />
          <Choice
            icon="🏪"
            title={copy.addSpecialTitle}
            hint={copy.addSpecialHint}
            onClick={() => setAdding("special")}
          />
          <Choice
            icon="📅"
            title={copy.addAppointmentTitle}
            hint={copy.addAppointmentHint}
            disabled
          />
        </div>
      </Sheet>

      {/* An hour this calendar will not take. */}
      <Sheet open={adding === "block"} onClose={close}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.addBlockTitle}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {said} · {resource?.name ?? ""}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field
              id="add-block-from"
              label={copy.from}
              type="time"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Field
              id="add-block-to"
              label={copy.to}
              type="time"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
          {until <= from && <Note>{copy.rangeInvalid}</Note>}
          {error !== null && <Critical>{error}</Critical>}
          <Button
            busy={busy}
            disabled={until <= from || resource === null}
            onClick={() =>
              void act(() =>
                api.createBlocks(token, business.id, resource?.id ?? "", [
                  {
                    startAt: instantOf(date, from, business.timeZone),
                    endAt: instantOf(date, until, business.timeZone),
                    reason: copy.blockedWord,
                  },
                ]),
              )
            }
          >
            {copy.save}
          </Button>
        </div>
      </Sheet>

      {/* A day the whole shop behaves differently. */}
      <Sheet open={adding === "special"} onClose={close}>
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
                id="add-special-from"
                label={copy.from}
                type="time"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Field
                id="add-special-to"
                label={copy.to}
                type="time"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          )}
          <Note>{copy.overrideReplaces}</Note>
          {error !== null && <Critical>{error}</Critical>}
          <Button
            busy={busy}
            disabled={!closedAllDay && until <= from}
            onClick={() =>
              void act(async () => {
                // The shop is every calendar: a special day the store keeps per
                // calendar, said once here.
                for (const one of resources) {
                  await api.putOverride(token, business.id, one.id, {
                    date,
                    note: null,
                    ranges: closedAllDay ? [] : [{ start: from, end: until }],
                  });
                }
              })
            }
          >
            {copy.save}
          </Button>
        </div>
      </Sheet>
    </>
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
