"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  BusinessDayDto,
  CalendarAppointmentDto,
  CalendarDayDto,
  ResourceDto,
} from "@/lib/api/types.ts";
import { todayIn, whenIn } from "@/lib/format.ts";
import { countOf } from "@/lib/i18n/counts.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { DateStrip } from "../date-strip.tsx";
import { AppointmentSheet } from "./appointment-sheet.tsx";
import { Month } from "./month.tsx";
import { DayTimeline, type Picked } from "./day-timeline.tsx";
import { DayActionSheet } from "./day-actions.tsx";
import { Card, Critical, Empty, Note, Spinner } from "../ui.tsx";

/**
 * The owner's day. ADR 0003 declines to keep this live: it is fetched on open
 * and on refresh, and the hint below says so rather than letting an owner
 * believe a stale screen is current.
 */
const VISIBLE_DAYS = 21;
/** Long enough that a name is one request, short enough to feel immediate. */
const SEARCH_SETTLE_MS = 250;

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
  /** The same day across every calendar, which is what the timeline draws. */
  const [wholeDay, setWholeDay] = useState<BusinessDayDto | null>(null);
  /** What a tap on the timeline opened: an item, or a stretch of free time. */
  const [picked, setPicked] = useState<Picked | null>(null);
  /** Reading every calendar at once, which only means anything past one. */
  const [showEveryone, setShowEveryone] = useState(false);
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
  /**
   * Finding an appointment by who booked it.
   *
   * A customer rings up about a time two months out. The calendar answers "what
   * is on this day", which is the wrong question — the owner knows the name and
   * not the date, and paging forward until it appears is a search conducted by
   * scrolling. While this box has something in it, it replaces the calendar
   * rather than sitting beside it: the owner is looking for one appointment,
   * not at a day.
   */
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<CalendarAppointmentDto[] | null>(null);

  const load = useCallback(async () => {
    if (resource === null) return;
    setBusy(true);
    try {
      const [oneCalendar, wholeDay] = await Promise.all([
        api.calendarDay(token, business.id, resource.id, date),
        api.businessDay(token, business.id, date),
      ]);
      setDay(oneCalendar);
      setWholeDay(wholeDay);
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
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setFound(null);
      return;
    }
    let current = true;
    // A short wait, so typing a name is one request rather than one per letter.
    const timer = window.setTimeout(() => {
      api
        .searchAppointments(token, business.id, trimmed)
        .then((matches) => {
          if (current) setFound(matches);
        })
        .catch(() => {
          if (current) setFound([]);
        });
    }, SEARCH_SETTLE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, token, business.id]);


  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      {resources.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="chip"
            aria-pressed={showEveryone}
            onClick={() => setShowEveryone(true)}
            style={{
              background: showEveryone ? "var(--accent)" : "var(--raised)",
              color: showEveryone ? "var(--on-accent)" : "var(--ink)",
              border: `1px solid ${showEveryone ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {copy.allCalendars}
          </button>
          {resources.map((candidate) => (
            <button
              key={candidate.id}
              className="chip"
              aria-pressed={!showEveryone && candidate.id === resource?.id}
              onClick={() => {
                setResource(candidate);
                setShowEveryone(false);
              }}
              style={{
                background:
                  !showEveryone && candidate.id === resource?.id
                    ? "var(--accent)"
                    : "var(--raised)",
                color:
                  !showEveryone && candidate.id === resource?.id
                    ? "var(--on-accent)"
                    : "var(--ink)",
                border: `1px solid ${
                  !showEveryone && candidate.id === resource?.id
                    ? "var(--accent)"
                    : "var(--line)"
                }`,
              }}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      <input
        className="field"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.findAppointment}
        aria-label={copy.findAppointment}
      />

      {found !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {found.length === 0 ? (
            <Empty title={copy.noMatches} body={copy.findAppointmentHint} />
          ) : (
            <>
              <span className="label">
                {countOf(language, found.length, copy.appointmentsCount)}
              </span>
              {found.map((appointment) => (
                <button
                  key={appointment.id}
                  onClick={() => setSelected(appointment)}
                  style={{ textAlign: "start" }}
                >
                  <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}
                    >
                      <span style={{ fontWeight: 500 }}>{appointment.customerName}</span>
                      <span className="hint">{appointment.serviceName}</span>
                    </span>
                    {/* The date is the answer here, so it leads rather than
                        being assumed from which day is open. */}
                    <span
                      className="tab"
                      style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 14 }}
                    >
                      {whenIn(appointment.startAt, business.timeZone, language)}
                    </span>
                  </Card>
                </button>
              ))}
              <Note>{copy.findAppointmentHint}</Note>
            </>
          )}
        </div>
      ) : (
      <>
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
        // The month is the whole business at once, and it is where a holiday
        // is taken: the grid answers "what does next month look like" and
        // "change this" with the same taps.
        <Month
          token={token}
          business={business}
          resources={resources}
          onOpenDay={(picked) => {
            setDate(picked);
            setView("days");
          }}
        />
      )}

      {error !== null && <Critical>{error}</Critical>}

      {busy && wholeDay === null ? (
        <Spinner />
      ) : wholeDay === null ? (
        <Empty title={copy.noAppointments} body={copy.refreshHint} />
      ) : (
        // The day as it will be lived: everything in one column against the
        // hours, with the free stretches tappable — they are the part an owner
        // wants to fill, and they used to be the part that was not there.
        <DayTimeline
          day={wholeDay}
          timeZone={business.timeZone}
          lanes={
            resource === null
              ? []
              : resources.length > 1 && showEveryone
                ? resources.map((one) => ({ id: one.id, name: one.name }))
                : [{ id: resource.id, name: resource.name }]
          }
          onPick={(entry) => {
            if (entry.kind === "appointment") {
              const found = day?.appointments.find((one) => one.id === entry.id) ?? null;
              setSelected(found);
              return;
            }
            setPicked(entry);
          }}
        />
      )}

      <DayActionSheet
        picked={picked}
        token={token}
        business={business}
        date={date}
        resources={resources}
        openHours={Object.fromEntries(
          (wholeDay?.calendars ?? []).map((calendar) => [calendar.resourceId, calendar.open]),
        )}
        onClose={() => setPicked(null)}
        onChanged={() => {
          setPicked(null);
          void load();
        }}
      />
      </>
      )}

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
