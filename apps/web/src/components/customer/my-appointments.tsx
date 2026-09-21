"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { MyAppointmentDto, PartOfDayName, WaitingDto } from "@/lib/api/types.ts";
import { distanceKm, distanceLabel, type GeoPoint } from "@/lib/distance.ts";
import { countdownTo, formatLocalDate, formatPrice } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { outcomeOfDto } from "../owner/appointment-sheet.tsx";
import { colourOf } from "../owner/event-colour.ts";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Empty, MultilineField, Sheet, Spinner, Warning } from "../ui.tsx";

/**
 * A customer's own appointments, across every business they have booked with.
 * The Cancellation Window governs what they are warned about, never whether the
 * button works: a customer may always cancel.
 *
 * The screen is ordered by what a customer opens it to find out. The next
 * appointment is one card of its own, carrying how far off it is, because
 * "am I late?" is the question and a date the reader has to compare against
 * today is not an answer. Everything else after it is a timeline grouped by
 * day, and the actions on those stay folded away until one is asked for —
 * four buttons of equal weight on every card made cancelling as loud as
 * adding to a calendar.
 */
export const MyAppointments = ({
  onOpenBusiness,
}: {
  onOpenBusiness: (businessId: string) => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const { token } = useSession();
  const errorText = useErrorText();

  const [appointments, setAppointments] = useState<MyAppointmentDto[] | null>(null);
  /** ADR 0018. What this customer is still waiting for. */
  const [waiting, setWaiting] = useState<WaitingDto[]>([]);
  const [cancelling, setCancelling] = useState<MyAppointmentDto | null>(null);
  const [noting, setNoting] = useState<MyAppointmentDto | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Where the reader is, when they let us know. */
  const [here, setHere] = useState<GeoPoint | null>(null);

  const load = useCallback(async () => {
    if (token === null) return;
    try {
      const [mine, standing] = await Promise.all([
        api.myAppointments(token),
        api.myWaiting(token),
      ]);
      setAppointments(mine);
      setWaiting(standing);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * One reading for the whole list, and only once something on it has a pin to
   * measure against — a permission prompt in front of somebody with no
   * appointments is a question about nothing. Denied or unavailable: the
   * addresses stay, the distances simply do not appear.
   */
  const anyPinned =
    appointments?.some(
      (appointment) =>
        appointment.businessLatitude !== null && appointment.businessLongitude !== null,
    ) ?? false;
  useEffect(() => {
    if (!anyPinned || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setHere({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => {
        // Denied or unavailable: no distance shown.
      },
      { timeout: 8000 },
    );
  }, [anyPinned]);

  const cancel = async () => {
    if (token === null || cancelling === null) return;
    setBusy(true);
    try {
      await api.cancel(token, cancelling.id);
      setCancelling(null);
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const openNote = (appointment: MyAppointmentDto) => {
    setDraftNote(appointment.customerNote ?? "");
    setNoting(appointment);
  };

  const saveNote = async () => {
    if (token === null || noting === null) return;
    setBusy(true);
    try {
      // An emptied box is a removed note; the API reads "" as null too.
      await api.setCustomerNote(token, noting.id, draftNote.trim() || null);
      setNoting(null);
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (appointments === null) return <Spinner page />;

  // The same rule the owner's screens use, from the same function: an
  // appointment is still ahead of you until it has ended. Splitting on the
  // start instead would move one out of the list while the customer was
  // sitting in it.
  //
  // Sorted here rather than trusted: which one is "next" is the whole shape of
  // this screen, and ISO instants compare as strings.
  const upcoming = appointments
    .filter((appointment) => outcomeOfDto(appointment) === "UPCOMING")
    .sort((one, other) => one.startAt.localeCompare(other.startAt));
  const past = appointments
    .filter((appointment) => outcomeOfDto(appointment) !== "UPCOMING")
    .sort((one, other) => other.startAt.localeCompare(one.startAt));

  const [next, ...later] = upcoming;
  const historyOpen = showPast || upcoming.length === 0;

  const locale = language === "he" ? "he-IL" : "en-GB";
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const clockFormat = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const formatDay = (appointment: MyAppointmentDto) =>
    dayFormat.format(new Date(appointment.startAt));

  /**
   * The day, then the span it occupies — a start alone left "and until when?"
   * to arithmetic the customer should not have to do. The end is the
   * appointment's own, so a service whose length changed later still reads as
   * it was booked.
   */
  const formatWhen = (appointment: MyAppointmentDto) =>
    `${formatDay(appointment)} · ${clockFormat.format(
      new Date(appointment.startAt),
    )}–${clockFormat.format(new Date(appointment.endAt))}`;

  /** How far the business is, as a straight line, when both ends are known. */
  const farFrom = (appointment: MyAppointmentDto): string | null => {
    const { businessLatitude: latitude, businessLongitude: longitude } = appointment;
    if (here === null || latitude === null || longitude === null) return null;
    return distanceLabel(distanceKm(here, { latitude, longitude }), copy);
  };

  const withWhom = (appointment: MyAppointmentDto) =>
    appointment.resourceName !== undefined && appointment.resourceName !== ""
      ? ` · ${copy.staffName} ${appointment.resourceName}`
      : "";

  // ponytail: Google's own URL scheme, no calendar API/dependency needed.
  const openInGoogleCalendar = (appointment: MyAppointmentDto) => {
    const toGoogleStamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `${appointment.serviceName} - ${appointment.businessName}`,
      dates: `${toGoogleStamp(appointment.startAt)}/${toGoogleStamp(appointment.endAt)}`,
    });
    window.open(`https://calendar.google.com/calendar/render?${params}`, "_blank");
  };

  const noteLabelFor = (appointment: MyAppointmentDto) =>
    appointment.customerNote === null || appointment.customerNote === ""
      ? copy.addNote
      : copy.editNote;

  const CustomerNote = ({ appointment }: { appointment: MyAppointmentDto }) =>
    appointment.customerNote === null || appointment.customerNote === "" ? null : (
      <Card padded={false} style={{ padding: 10, background: "var(--sunken)" }}>
        <span className="label">{copy.customerNote}</span>
        <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {appointment.customerNote}
        </p>
      </Card>
    );

  /**
   * The four actions, compact. A full-width button is the weight this system
   * gives the one thing a screen is for, and none of these is that: on a list
   * they are things you might do to a line of it, so they take the pill the
   * rest of the app gives small actions.
   */
  const ACTION: React.CSSProperties = {
    minHeight: 36,
    padding: "0 12px",
    fontSize: 12.5,
    background: "var(--raised)",
    border: "1px solid var(--line)",
  };

  const Actions = ({ appointment }: { appointment: MyAppointmentDto }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button
        type="button"
        className="chip tap"
        onClick={() => openInGoogleCalendar(appointment)}
        style={{ ...ACTION, color: "var(--accent-strong)" }}
      >
        {copy.addToCalendar}
      </button>
      <button
        type="button"
        className="chip tap"
        onClick={() => onOpenBusiness(appointment.businessId)}
        style={ACTION}
      >
        {copy.navigateToBusiness}
      </button>
      <button
        type="button"
        className="chip tap"
        onClick={() => openNote(appointment)}
        style={ACTION}
      >
        {noteLabelFor(appointment)}
      </button>
      <button
        type="button"
        className="chip tap"
        onClick={() => setCancelling(appointment)}
        style={{ ...ACTION, color: "var(--critical)" }}
      >
        {copy.cancelAppointment}
      </button>
    </div>
  );

  // The days the rest of the upcoming list is grouped under. The list is
  // already in order, so consecutive runs are the groups.
  const days = later.reduce<{ day: string; rail: string; items: MyAppointmentDto[] }[]>(
    (groups, appointment) => {
      const day = formatDay(appointment);
      const last = groups.at(-1);
      if (last !== undefined && last.day === day) last.items.push(appointment);
      // The day's own mark is its first appointment's service colour, taken
      // here rather than off items[0] later: a group always has a first one at
      // the moment it is made, which indexing back into it cannot promise.
      else groups.push({ day, rail: colourOf(appointment.serviceName).rail, items: [appointment] });
      return groups;
    },
    [],
  );

  return (
    <div style={{ padding: "22px 18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 22 }}>{copy.myAppointments}</h1>

      {error !== null && <Critical>{error}</Critical>}

      {upcoming.length === 0 && past.length === 0 && waiting.length === 0 && (
        <Empty title={copy.noAppointments} body={copy.noAppointmentsBody} />
      )}

      {/* Above the appointments, not below: a thing you are waiting for needs
          chasing more than a thing already settled. */}
      {waiting.length > 0 && (
        <WaitingList
          waiting={waiting}
          onRemove={async (entryId) => {
            if (token === null) return;
            setWaiting((held) => held.filter((one) => one.id !== entryId));
            try {
              await api.stopWaiting(token, entryId);
            } catch (cause) {
              setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
              await load();
            }
          }}
        />
      )}

      {next !== undefined && (
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                flex: 1,
                fontFamily: "Rubik, sans-serif",
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".04em",
                color: "var(--accent)",
              }}
            >
              {copy.nextAppointment}
            </span>
            {/* How far off it is, which is the question the screen is opened
                with; the date below settles which day it was. */}
            <span
              className="tab"
              style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-strong)" }}
            >
              {countdownTo(next.startAt, language)}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* What it costs and how long it takes ride with the name they
                belong to — the two facts checked against the reader's own day,
                out of the sentence below. */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  flex: 1,
                  fontFamily: "Rubik, sans-serif",
                  fontWeight: 600,
                  fontSize: 17,
                }}
              >
                {next.serviceName}
              </span>
              <span className="hint tab">
                {next.durationMinutes} {copy.minutes}
              </span>
              <span className="tab" style={{ fontSize: 14, fontWeight: 600 }}>
                {formatPrice(next.priceMinor, language, copy.free)}
              </span>
            </div>
            <span className="hint">
              {next.businessName}
              {withWhom(next)}
            </span>
            {/* Where it is, and how far that is from here — the address is the
                fact a customer scans for, the distance is the one they judge
                by, and neither is worth a line of its own. */}
            {(next.businessAddress !== null || farFrom(next) !== null) && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                {next.businessAddress !== null && (
                  <span className="hint" style={{ flex: 1 }}>
                    {next.businessAddress}
                  </span>
                )}
                {farFrom(next) !== null && (
                  <span
                    className="tab"
                    style={{
                      flexShrink: 0,
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: "var(--accent-soft)",
                      color: "var(--accent-strong)",
                    }}
                  >
                    {farFrom(next)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <span className="tab" style={{ fontSize: 14, fontWeight: 500 }}>
              {formatWhen(next)}
            </span>
          </div>

          <CustomerNote appointment={next} />

          <Actions appointment={next} />
        </Card>
      )}

      {days.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="label">{copy.later}</span>
          {days.map(({ day, rail, items }) => (
            <div key={day} style={{ display: "flex", gap: 12 }}>
              {/* The rail: a dot per day and a line down the rest of it, so a
                  week of appointments reads as a sequence rather than a stack
                  of identical cards. */}
              <div
                aria-hidden="true"
                style={{
                  width: 9,
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 22,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: rail,
                  }}
                />
                <span style={{ flex: 1, width: 2, background: "var(--line)" }} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="hint tab">{day}</span>
                {items.map((appointment) => {
                  const open = opened === appointment.id;
                  return (
                    <Card
                      key={appointment.id}
                      padded={false}
                      style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpened(open ? null : appointment.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "start" }}
                      >
                        <span
                          className="tab"
                          style={{
                            width: 46,
                            flexShrink: 0,
                            fontFamily: "Rubik, sans-serif",
                            fontWeight: 600,
                            fontSize: 15,
                            color: colourOf(appointment.serviceName).rail,
                          }}
                        >
                          {clockFormat.format(new Date(appointment.startAt))}
                        </span>
                        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>
                              {appointment.serviceName}
                            </span>
                            <span className="hint tab">
                              {appointment.durationMinutes} {copy.minutes}
                            </span>
                            <span className="tab" style={{ fontSize: 13.5, fontWeight: 600 }}>
                              {formatPrice(appointment.priceMinor, language, copy.free)}
                            </span>
                          </span>
                          <span className="hint">
                            {[appointment.businessName, appointment.businessAddress, farFrom(appointment)]
                              .filter((part) => part !== null && part !== "")
                              .join(" · ")}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="hint"
                          style={{
                            transition: "transform .13s ease",
                            transform: open ? "rotate(90deg)" : undefined,
                          }}
                        >
                          ›
                        </span>
                      </button>
                      {open && (
                        <>
                          <CustomerNote appointment={appointment} />
                          <Actions appointment={appointment} />
                        </>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Folded by default: a record that runs back years is not what the
              screen is opened for, and it pushed the next appointment off it.
              With nothing upcoming there is nothing for it to push off, and a
              lone dashed button is not a screen — so it stands open and the
              toggle goes away. */}
          {upcoming.length > 0 && (
          <button
            type="button"
            className="tap"
            aria-expanded={showPast}
            onClick={() => setShowPast(!showPast)}
            style={{
              minHeight: 52,
              padding: "0 16px",
              borderRadius: 16,
              border: "1px dashed var(--line)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--muted)",
            }}
          >
            <span
              style={{
                flex: 1,
                textAlign: "start",
                fontFamily: "Rubik, sans-serif",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {copy.history}
            </span>
            <span className="hint tab">{past.length}</span>
            <span aria-hidden="true" className="hint" style={{ fontSize: 14 }}>
              {showPast ? "⌃" : "⌄"}
            </span>
          </button>
          )}

          {historyOpen &&
            past.map((appointment) => (
              <Card
                key={appointment.id}
                style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.72 }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span
                    className={appointment.status === "CANCELLED" ? "cancelled" : "spent"}
                    style={{ flex: 1, fontWeight: 500 }}
                  >
                    {appointment.serviceName} - {appointment.businessName}
                  </span>
                  <span className="hint">
                    {appointment.status === "CANCELLED"
                      ? copy.cancelled
                      : outcomeOfDto(appointment) === "NO_SHOW"
                        ? copy.didNotArrive
                        : copy.finished}
                  </span>
                </div>
                <span
                  className={
                    appointment.status === "CANCELLED" ? "cancelled hint" : "spent hint"
                  }
                >
                  {formatWhen(appointment)}
                  {withWhom(appointment)}
                </span>
              </Card>
            ))}
        </div>
      )}

      <Sheet open={noting !== null} onClose={() => setNoting(null)} labelledBy="note-title">
        {noting !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="note-title" style={{ fontSize: 20 }}>{copy.noteLabel}</h2>
            <p className="hint" style={{ margin: 0 }}>{formatWhen(noting)}</p>
            <MultilineField
              id="customer-note"
              label={copy.noteLabel}
              hint={copy.noteHint}
              placeholder={copy.notePlaceholder}
              maxLength={500}
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
            />
            <Button intent="primary" onClick={saveNote} busy={busy}>
              {copy.saveNote}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={cancelling !== null} onClose={() => setCancelling(null)} labelledBy="cancel-title">
        {cancelling !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="cancel-title" style={{ fontSize: 20 }}>{copy.cancelAppointment}</h2>
            <p className="hint" style={{ margin: 0 }}>{formatWhen(cancelling)}</p>
            {/* The window governs visibility, not permission — the warning is
                shown, and the action stays available either way. */}
            <Warning>{copy.lateWarning}</Warning>
            <Button intent="danger" onClick={cancel} busy={busy}>
              {copy.cancelAppointment}
            </Button>
            <Button intent="quiet" onClick={() => setCancelling(null)}>
              {copy.keepIt}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

/**
 * ADR 0018. What this customer is still waiting for.
 *
 * Deliberately quieter than an appointment and shaped differently: one is a
 * time somebody holds, the other is a question somebody asked. Drawing them
 * alike would be the first step towards a customer believing they have a
 * booking they do not.
 */
const WaitingList = ({
  waiting,
  onRemove,
}: {
  waiting: readonly WaitingDto[];
  onRemove: (entryId: string) => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();

  const partNames = (parts: readonly PartOfDayName[]): string =>
    parts.length === 3
      ? copy.waitAnyHour
      : parts.map((part) => copy[PART_COPY[part]]).join(" · ");

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="label" style={{ color: "var(--caution)" }}>
        {copy.waitingTitle}
      </span>
      {waiting.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            borderRadius: 16,
            padding: "12px 14px",
            background: "var(--caution-soft)",
            border: "1px solid color-mix(in oklab, var(--caution) 26%, transparent)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>
              {entry.serviceName} · {entry.businessName}
            </b>
            <p className="hint" style={{ margin: "3px 0 0" }}>
              {formatLocalDate(entry.onDate, language)} · {partNames(entry.parts)}
              {entry.resourceNames.length > 0 && ` · ${entry.resourceNames.join(", ")}`}
            </p>
          </div>
          <button
            onClick={() => onRemove(entry.id)}
            aria-label={`${copy.waitingRemove} ${entry.serviceName}`}
            style={{
              minHeight: 34,
              padding: "0 12px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              background: "var(--raised)",
              border: "1px solid var(--line)",
              color: "var(--muted)",
            }}
          >
            {copy.waitingRemove}
          </button>
        </div>
      ))}
    </section>
  );
};

/** The dictionary key for each part, so the wire's name never reaches a screen. */
const PART_COPY: Readonly<Record<PartOfDayName, "morning" | "noon" | "evening">> =
  Object.freeze({
    MORNING: "morning",
    NOON: "noon",
    EVENING: "evening",
  });
