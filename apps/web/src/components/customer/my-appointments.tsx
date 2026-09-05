"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { MyAppointmentDto } from "@/lib/api/types.ts";
import { formatPrice } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { outcomeOfDto } from "../owner/appointment-sheet.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Empty, MultilineField, Sheet, Spinner, Warning } from "../ui.tsx";

/**
 * A customer's own appointments, across every business they have booked with.
 * The Cancellation Window governs what they are warned about, never whether the
 * button works: a customer may always cancel.
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
  const [cancelling, setCancelling] = useState<MyAppointmentDto | null>(null);
  const [noting, setNoting] = useState<MyAppointmentDto | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (token === null) return;
    try {
      setAppointments(await api.myAppointments(token));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (appointments === null) return <Spinner />;

  // The same rule the owner's screens use, from the same function: an
  // appointment is still ahead of you until it has ended. Splitting on the
  // start instead would move one out of the list while the customer was
  // sitting in it.
  const upcoming = appointments.filter(
    (appointment) => outcomeOfDto(appointment) === "UPCOMING",
  );
  const past = appointments.filter((appointment) => !upcoming.includes(appointment));

  const locale = language === "he" ? "he-IL" : "en-GB";

  /**
   * The day, then the span it occupies — a start alone left "and until when?"
   * to arithmetic the customer should not have to do. The end is the
   * appointment's own, so a service whose length changed later still reads as
   * it was booked.
   */
  const formatWhen = (appointment: MyAppointmentDto) => {
    const day = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(appointment.startAt));
    const clock = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${day} · ${clock.format(new Date(appointment.startAt))}–${clock.format(
      new Date(appointment.endAt),
    )}`;
  };

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

  return (
    <div style={{ padding: "22px 18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 22 }}>{copy.myAppointments}</h1>

      {error !== null && <Critical>{error}</Critical>}

      {upcoming.length === 0 && past.length === 0 && (
        <Empty title={copy.noAppointments} body={copy.noAppointmentsBody} />
      )}

      {upcoming.map((appointment) => (
        <Card key={appointment.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ flex: 1, fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 16 }}>
              {appointment.serviceName} - {appointment.businessName}
            </span>
            {/* What it costs and how long it takes, as it was booked: the two
                facts a customer checks against their own day, side by side and
                out of the sentence below. */}
            <span style={{ display: "flex", alignItems: "baseline", gap: 7, flexShrink: 0 }}>
              <span className="hint tab">
                {appointment.durationMinutes} {copy.minutes}
              </span>
              <span className="tab" style={{ fontSize: 14 }}>
                {formatPrice(appointment.priceMinor, language, copy.free)}
              </span>
            </span>
          </div>
          <span className="hint">
            {formatWhen(appointment)}
            {appointment.resourceName !== undefined && appointment.resourceName !== ""
              ? ` · ${copy.staffName} ${appointment.resourceName}`
              : ""}
          </span>
          {appointment.customerNote !== null && appointment.customerNote !== "" && (
            <Card padded={false} style={{ padding: 10, background: "var(--sunken)" }}>
              <span className="label">{copy.customerNote}</span>
              <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {appointment.customerNote}
              </p>
            </Card>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Button intent="primary" onClick={() => openInGoogleCalendar(appointment)}>
              {copy.addToCalendar}
            </Button>
            <Button intent="quiet" onClick={() => onOpenBusiness(appointment.businessId)}>
              {copy.navigateToBusiness}
            </Button>
            <Button intent="quiet" onClick={() => openNote(appointment)}>
              {appointment.customerNote === null || appointment.customerNote === ""
                ? copy.addNote
                : copy.editNote}
            </Button>
            <Button intent="quiet" onClick={() => setCancelling(appointment)}>
              {copy.cancelAppointment}
            </Button>
          </div>
        </Card>
      ))}

      {past.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {past.map((appointment) => (
            <Card key={appointment.id} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.72 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span
                  className={
                    appointment.status === "CANCELLED" ? "cancelled" : "spent"
                  }
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
                {formatWhen(appointment)} · {copy.staffName} {appointment.resourceName}
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
