"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, CalendarAppointmentDto, SlotDto } from "@/lib/api/types.ts";
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
          {error !== null && <Critical>{error}</Critical>}

          {appointment.status === "CONFIRMED" && (
            <>
              <Button onClick={() => void loadMoveOptions(appointment)}>{copy.moveAppointment}</Button>
              <Button intent="quiet" onClick={() => act(() => api.markNoShow(token, appointment.id))} busy={busy}>
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

export const StatusTag = ({
  appointment,
  copy,
}: {
  appointment: { status: string; lateCancellation: boolean };
  copy: { lateTag: string; noShowTag: string; cancelledTag: string };
}) => {
  if (appointment.status === "NO_SHOW") return <Tag text={copy.noShowTag} tone="caution" />;
  if (appointment.status === "CANCELLED") return <Tag text={copy.cancelledTag} tone="critical" />;
  if (appointment.lateCancellation) return <Tag text={copy.lateTag} tone="caution" />;
  return null;
};

const Tag = ({ text, tone }: { text: string; tone: "caution" | "critical" }) => (
  <span
    style={{
      fontSize: 11.5,
      padding: "4px 9px",
      borderRadius: 999,
      background: `var(--${tone}-soft)`,
      color: `var(--${tone})`,
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </span>
);
