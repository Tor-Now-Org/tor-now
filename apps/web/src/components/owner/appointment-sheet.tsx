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
import { Button, Card, Critical, Note, Sheet, Spinner, Warning } from "../ui.tsx";

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
  const ended =
    appointment !== null && outcomeOf(
      { status: appointment.status, endAt: parseInstant(appointment.endAt) },
      now,
    ) === "FINISHED";

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
            <Detail
              label={copy.rWhen}
              value={`${timeIn(appointment.startAt, business.timeZone, language)}–${timeIn(appointment.endAt, business.timeZone, language)}`}
            />
            <Detail label={copy.price} value={formatPrice(appointment.priceMinor, language, "—")} />
            <Detail
              label={copy.searchCustomer}
              value={`${appointment.customerName} · ${appointment.customerPhone}`}
            />
          </Card>

          {appointment.status === "NO_SHOW" && <Warning>{copy.noShowNote}</Warning>}
          {appointment.status === "CANCELLED" && <Note>{copy.cancelledNote}</Note>}
          {/* Said before the buttons rather than after a refused click. A
              control that is disabled and silent is the same problem as one
              that fails when pressed — the person still does not know why. */}
          {appointment.status === "CONFIRMED" && started && (
            <Note>{copy.startedNote}</Note>
          )}
          {appointment.status === "CONFIRMED" && !ended && (
            <Note>{copy.noShowAfterNote}</Note>
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
              <Button
                intent="quiet"
                onClick={() => act(() => api.markNoShow(token, appointment.id))}
                busy={busy}
                // Marking a no show before the appointment has ended is
                // refused by the domain, so it is not offered either.
                disabled={!ended}
              >
                {copy.markNoShow}
              </Button>
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
const TONES: Readonly<
  Record<string, { background: string; border: string; color: string }>
> = Object.freeze({
  positive: {
    background: "var(--positive-soft)",
    border: "1px solid oklch(58% 0.115 214/.28)",
    color: "var(--positive)",
  },
  caution: {
    background: "var(--caution-soft)",
    border: "1px solid oklch(63% 0.125 65/.3)",
    color: "var(--caution)",
  },
  critical: {
    background: "var(--critical-soft)",
    border: "1px solid oklch(55% 0.170 22/.25)",
    color: "var(--critical)",
  },
  neutral: {
    background: "var(--sunken)",
    border: "1px solid var(--line)",
    color: "var(--muted)",
  },
});

const Tag = ({
  text,
  tone,
}: {
  text: string;
  tone: "caution" | "critical" | "neutral" | "positive";
}) => (
  <span
    style={{
      display: "inline-flex",
      padding: "4px 11px",
      borderRadius: 999,
      fontSize: 11.5,
      fontWeight: 500,
      whiteSpace: "nowrap",
      ...TONES[tone],
    }}
  >
    {text}
  </span>
);
