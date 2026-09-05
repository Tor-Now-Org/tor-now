"use client";

import { useState } from "react";
import {
  hasStarted,
  instant,
  outcomeOf,
  parseInstant,
  type AppointmentOutcome,
} from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  AppointmentStatus,
  BusinessDto,
  CalendarAppointmentDto,
  SlotDto,
} from "@/lib/api/types.ts";
import { formatPrice, timeIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { PhoneActions } from "../phone-actions.tsx";
import { Button, Card, Critical, Note, Sheet, Spinner, Tag, Warning } from "../ui.tsx";

/**
 * What an owner can do to one appointment: move it, mark a no show, take the
 * mark off again, or cancel it.
 *
 * Lifted out of the day calendar because the customer's own page needs exactly
 * the same thing, and an appointment that could be cancelled from one screen
 * and not the other would be a difference nobody meant. The screen that opens
 * it says which appointment; everything about what may be done to it, and what
 * that costs the customer, is here.
 */
export const AppointmentSheet = ({
  token,
  business,
  appointment,
  onClose,
  onChanged,
}: {
  token: string;
  business: BusinessDto;
  /** Null closes the sheet; the caller owns which appointment is open. */
  appointment: CalendarAppointmentDto | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [moving, setMoving] = useState(false);
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = instant(Date.now());
  const started =
    appointment !== null && hasStarted({ startAt: parseInstant(appointment.startAt) }, now);


  const close = () => {
    setMoving(false);
    setSlots(null);
    setError(null);
    onClose();
  };

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      close();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const loadMoveOptions = async (open: CalendarAppointmentDto) => {
    setMoving(true);
    setSlots(null);
    const [available] = await api.availability(business.id, {
      serviceId: open.serviceId,
      resourceId: open.resourceId,
      from: open.startAt.slice(0, 10),
      to: open.startAt.slice(0, 10),
    });
    setSlots(available?.slots ?? []);
  };

  return (
    <Sheet open={appointment !== null} onClose={close}>
      {appointment !== null && !moving && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 19 }}>{copy.whatHappened}</h2>
          <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Detail label={copy.rService} value={appointment.serviceName} />
            {appointment.resourceName !== undefined && appointment.resourceName !== "" && (
              <Detail label={copy.rProvider} value={appointment.resourceName} />
            )}
            <Detail
              label={copy.rWhen}
              value={`${timeIn(appointment.startAt, business.timeZone, language)}–${timeIn(appointment.endAt, business.timeZone, language)}`}
            />
            <Detail label={copy.price} value={formatPrice(appointment.priceMinor, language, "—")} />
          </Card>

          {/* The customer, as a person rather than as a row.
              This was a labelled field whose label was the customers list's
              search placeholder — "search by name or phone" — reused because
              it happened to contain both words. It read as an instruction, and
              the name and the number were run together on one line with a dot
              between them. They are what an owner looks at when the phone
              rings, so they are the thing on the card, and the number is
              ready to ring or to take away. */}
          <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                width: 42,
                height: 42,
                flexShrink: 0,
                borderRadius: 14,
                background: "var(--accent-soft)",
                color: "var(--accent-strong)",
                fontFamily: "Rubik, sans-serif",
                fontSize: 17,
              }}
            >
              {appointment.customerName.trim().charAt(0) || "?"}
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 15.5 }}>
                {appointment.customerName}
              </span>
              <span className="tab" dir="ltr" style={{ fontSize: 13, color: "var(--muted)" }}>
                {appointment.customerPhone}
              </span>
            </span>
            <PhoneActions
              phone={appointment.customerPhone}
              labels={{ call: copy.callCustomer, whatsapp: copy.whatsappCustomer }}
            />
          </Card>

          {/* What the customer wrote when they booked. Shown right under who
              they are, because it is usually about this appointment
              specifically — a child coming along, a time constraint, where
              they will be parked — and is no use to the owner discovered
              afterwards. */}
          {appointment.customerNote !== null && appointment.customerNote !== "" && (
            <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">{copy.customerNote}</span>
              <span style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {appointment.customerNote}
              </span>
            </Card>
          )}

          {appointment.status === "NO_SHOW" && <Warning>{copy.noShowNote}</Warning>}
          {appointment.status === "CANCELLED" && <Note>{copy.cancelledNote}</Note>}
          {/* Said before the buttons rather than after a refused click. A
              control that is disabled and silent is the same problem as one
              that fails when pressed — the person still does not know why. */}
          {appointment.status === "CONFIRMED" && started && (
            <Note>{copy.startedNote}</Note>
          )}
          {error !== null && <Critical>{error}</Critical>}

          {appointment.status === "CONFIRMED" && (
            <>
              {/* An appointment that has begun cannot be given a different
                  time — the time it was given has been spent. What is left is
                  to record what happened. The API refuses it too; this is not
                  the only thing standing in the way. */}
              {!started && (
                <Button onClick={() => void loadMoveOptions(appointment)}>
                  {copy.moveAppointment}
                </Button>
              )}
              {/* Only once it has begun. Before that there is nothing to say
                  about whether anybody turned up, and an offer the domain would
                  refuse is worse than no offer — it has to be taken to find
                  out. From the appointed time it simply works, so it needs no
                  explaining either. */}
              {started && (
                <Button
                  intent="quiet"
                  onClick={() => act(() => api.markNoShow(token, appointment.id))}
                  busy={busy}
                >
                  {copy.markNoShow}
                </Button>
              )}
              <Button intent="danger" onClick={() => act(() => api.cancel(token, appointment.id))} busy={busy}>
                {copy.cancelAppointment}
              </Button>
            </>
          )}

          {appointment.status === "NO_SHOW" && (
            <Button intent="quiet" onClick={() => act(() => api.clearNoShow(token, appointment.id))} busy={busy}>
              {copy.undoNoShow}
            </Button>
          )}
        </div>
      )}

      {appointment !== null && moving && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 19 }}>{copy.pickNewTime}</h2>
          {/* A reschedule keeps the appointment's identity and is never a
              cancellation, so it is not counted against the customer. */}
          <Warning>{copy.rescheduleWarn}</Warning>
          {slots === null ? (
            <Spinner />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
              {slots.map((slot) => (
                <button
                  key={slot.startAt}
                  className="tab"
                  onClick={() => act(() => api.reschedule(token, appointment.id, slot.startAt))}
                  style={{
                    minHeight: 46,
                    borderRadius: 13,
                    border: "1px solid var(--line)",
                    background: "var(--raised)",
                    fontSize: 15,
                  }}
                >
                  {timeIn(slot.startAt, business.timeZone, language)}
                </button>
              ))}
            </div>
          )}
          {error !== null && <Critical>{error}</Critical>}
          <Button intent="quiet" onClick={() => setMoving(false)}>{copy.back}</Button>
        </div>
      )}
    </Sheet>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
    <span className="label" style={{ minWidth: 72 }}>{label}</span>
    <span style={{ fontSize: 14.5 }}>{value}</span>
  </div>
);

/** The tag beside an appointment in a list, and the strike that goes with it. */
export const isCancelled = (appointment: { status: string }): boolean =>
  appointment.status === "CANCELLED";

/**
 * What a listed appointment is, right now. One function so the owner's day, the
 * customer's page and the customer's own list cannot disagree about which of
 * these has already happened.
 */
export const outcomeOfDto = (appointment: {
  status: AppointmentStatus;
  endAt: string;
}): AppointmentOutcome =>
  outcomeOf(
    { status: appointment.status, endAt: parseInstant(appointment.endAt) },
    instant(Date.now()),
  );

/** Finished and cancelled are both spent; a list greys them the same way. */
export const isSpent = (appointment: {
  status: AppointmentStatus;
  endAt: string;
}): boolean => {
  const outcome = outcomeOfDto(appointment);
  return outcome === "FINISHED" || outcome === "CANCELLED";
};

export const StatusTag = ({
  appointment,
  copy,
  nameUpcoming,
}: {
  appointment: { status: AppointmentStatus; endAt: string; lateCancellation: boolean };
  copy: {
    lateTag: string;
    noShowTag: string;
    cancelledTag: string;
    happened: string;
    booked: string;
  };
  /** The canvas's customer card labels an upcoming one too; a day's list does not. */
  nameUpcoming?: boolean;
}) => {
  const outcome = outcomeOfDto(appointment);
  if (outcome === "NO_SHOW") return <Tag text={copy.noShowTag} tone="caution" />;
  if (outcome === "CANCELLED") return <Tag text={copy.cancelledTag} tone="critical" />;
  if (appointment.lateCancellation) return <Tag text={copy.lateTag} tone="caution" />;
  // Nobody marked this attended; the clock did. Said quietly, because it is the
  // ordinary end of an appointment rather than an incident.
  if (outcome === "FINISHED") return <Tag text={copy.happened} tone="neutral" />;
  return nameUpcoming === true ? <Tag text={copy.booked} tone="positive" /> : null;
};

/** The canvas's tag: a soft ground, a hairline of the same hue, and the hue. */
