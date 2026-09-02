"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  CalendarAppointmentDto,
  CalendarDayDto,
  MonthDayDto,
  ResourceDto,
} from "@/lib/api/types.ts";
import { monthName, timeIn, todayIn } from "@/lib/format.ts";
import { countOf } from "@/lib/i18n/counts.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { DateStrip } from "../date-strip.tsx";
import { AppointmentSheet, StatusTag, isCancelled } from "./appointment-sheet.tsx";
import { MonthGrid, firstOfMonthFor, shiftMonth } from "./month-grid.tsx";
import { Card, Critical, Empty, Note, Spinner } from "../ui.tsx";

/**
 * The owner's day. ADR 0003 declines to keep this live: it is fetched on open
 * and on refresh, and the hint below says so rather than letting an owner
 * believe a stale screen is current.
 */
const VISIBLE_DAYS = 21;

export const CalendarDay = ({
  token,
  business,
  resources,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [resource, setResource] = useState<ResourceDto | null>(null);

  // Resources are fetched by the parent and arrive after this mounts, so the
  // selection cannot come from the initial render alone — it has to follow the
  // list. Without this the screen waits forever for a calendar it already has.
  useEffect(() => {
    setResource((current) =>
      current !== null && resources.some((candidate) => candidate.id === current.id)
        ? current
        : (resources[0] ?? null),
    );
  }, [resources]);
  const [date, setDate] = useState(() => todayIn(business.timeZone));
  const [day, setDay] = useState<CalendarDayDto | null>(null);
  const [selected, setSelected] = useState<CalendarAppointmentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Two ways of looking at the same calendar. The strip answers "what is
   * happening this week"; the month answers "which days are busy" — the
   * question behind a holiday, an extra shift, or ringing a customer back next
   * Tuesday. Both end at the same day's list, so switching never loses the day.
   */
  const [view, setView] = useState<"days" | "month">("days");
  const [month, setMonth] = useState<MonthDayDto[] | null>(null);
  const firstOfMonth = firstOfMonthFor(date);

  const load = useCallback(async () => {
    if (resource === null) return;
    setBusy(true);
    try {
      setDay(await api.calendarDay(token, business.id, resource.id, date));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  }, [token, business.id, resource, date, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (view !== "month" || resource === null) {
      setMonth(null);
      return;
    }
    let current = true;
    api
      .calendarMonth(token, business.id, resource.id, firstOfMonth)
      .then((days) => {
        if (current) setMonth(days);
      })
      .catch(() => {
        if (current) setMonth([]);
      });
    return () => {
      current = false;
    };
  }, [view, token, business.id, resource, firstOfMonth]);

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      {resources.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {resources.map((candidate) => (
            <button
              key={candidate.id}
              className="chip"
              aria-pressed={candidate.id === resource?.id}
              onClick={() => setResource(candidate)}
              style={{
                background: candidate.id === resource?.id ? "var(--accent)" : "var(--raised)",
                color: candidate.id === resource?.id ? "var(--on-accent)" : "var(--ink)",
                border: `1px solid ${candidate.id === resource?.id ? "var(--accent)" : "var(--line)"}`,
              }}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["days", "month"] as const).map((candidate) => (
            <button
              key={candidate}
              className="chip"
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              style={{
                background: view === candidate ? "var(--accent-soft)" : "transparent",
                color: view === candidate ? "var(--accent-strong)" : "var(--muted)",
                border: `1px solid ${view === candidate ? "var(--accent)" : "var(--line)"}`,
              }}
            >
              {candidate === "days" ? copy.viewDays : copy.viewMonth}
            </button>
          ))}
        </div>

      </div>

      {view === "days" ? (
        <DateStrip
          from={todayIn(business.timeZone)}
          days={VISIBLE_DAYS}
          selected={date}
          onSelect={setDate}
          todayLabel={copy.today}
          weekdayNames={copy.days}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="chip"
              aria-label={copy.previousMonth}
              onClick={() => setDate(shiftMonth(firstOfMonth, -1))}
              style={{ border: "1px solid var(--line)", minWidth: 44 }}
            >
              ‹
            </button>
            <span style={{ flex: 1, textAlign: "center", fontWeight: 600 }}>
              {monthName(firstOfMonth, business.timeZone, language)}
            </span>
            <button
              className="chip"
              aria-label={copy.nextMonth}
              onClick={() => setDate(shiftMonth(firstOfMonth, 1))}
              style={{ border: "1px solid var(--line)", minWidth: 44 }}
            >
              ›
            </button>
          </div>
          {month === null ? (
            <Spinner />
          ) : (
            <MonthGrid
              firstOfMonth={firstOfMonth}
              days={month}
              selected={date}
              today={todayIn(business.timeZone)}
              onSelect={setDate}
              weekdayNames={copy.days}
              labels={{
                appointments: copy.appointmentsWord,
                blocked: copy.blockedWord,
                empty: copy.noAppointments,
              }}
            />
          )}
        </div>
      )}

      {error !== null && <Critical>{error}</Critical>}

      {busy && day === null ? (
        <Spinner />
      ) : day === null || day.appointments.length + day.blocks.length === 0 ? (
        <Empty title={copy.noAppointments} body={copy.refreshHint} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="label">
            {countOf(language, day.appointments.length, copy.appointmentsCount)}
          </span>

          {day.appointments.map((appointment) => (
            <button key={appointment.id} onClick={() => setSelected(appointment)} style={{ textAlign: "start" }}>
              <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 12 }}>
                {/* The tag says it, the strike shows it: an owner reading a
                    day's list should not have to read every tag to see which
                    of these still stand. The tag itself is left alone. */}
                <span
                  className={isCancelled(appointment) ? "tab cancelled" : "tab"}
                  style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 15 }}
                >
                  {timeIn(appointment.startAt, business.timeZone, language)}
                </span>
                <span
                  className={isCancelled(appointment) ? "cancelled" : undefined}
                  style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span style={{ fontWeight: 500 }}>{appointment.customerName}</span>
                  <span className="hint">{appointment.serviceName}</span>
                </span>
                <StatusTag appointment={appointment} copy={copy} />
              </Card>
            </button>
          ))}

          {day.blocks.map((block) => (
            <Card key={block.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--sunken)" }}>
              <span className="tab hint">{timeIn(block.startAt, business.timeZone, language)}</span>
              <span style={{ flex: 1 }} className="hint">{block.reason}</span>
            </Card>
          ))}
        </div>
      )}

      <Note>{copy.refreshHint}</Note>

      <AppointmentSheet
        token={token}
        business={business}
        appointment={selected}
        onClose={() => setSelected(null)}
        onChanged={load}
      />
    </div>
  );
};
