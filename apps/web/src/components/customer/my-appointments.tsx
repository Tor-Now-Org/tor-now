"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { AppointmentDto } from "@/lib/api/types.ts";
import { formatPrice } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Empty, Sheet, Spinner, Warning } from "../ui.tsx";

/**
 * A customer's own appointments, across every business they have booked with.
 * The Cancellation Window governs what they are warned about, never whether the
 * button works: a customer may always cancel.
 */
export const MyAppointments = () => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const { token } = useSession();
  const errorText = useErrorText();

  const [appointments, setAppointments] = useState<AppointmentDto[] | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentDto | null>(null);
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

  if (appointments === null) return <Spinner />;

  const upcoming = appointments.filter(
    (appointment) =>
      appointment.status === "CONFIRMED" &&
      new Date(appointment.startAt).getTime() > Date.now(),
  );
  const past = appointments.filter((appointment) => !upcoming.includes(appointment));

  const formatWhen = (appointment: AppointmentDto) =>
    new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(appointment.startAt));

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
              {appointment.serviceName}
            </span>
            <span className="tab" style={{ fontSize: 14 }}>
              {formatPrice(appointment.priceMinor, language, copy.free)}
            </span>
          </div>
          <span className="hint">{formatWhen(appointment)}</span>
          <Button intent="quiet" onClick={() => setCancelling(appointment)}>
            {copy.cancelAppointment}
          </Button>
        </Card>
      ))}

      {past.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {past.map((appointment) => (
            <Card key={appointment.id} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.72 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span
                  className={appointment.status === "CANCELLED" ? "cancelled" : undefined}
                  style={{ flex: 1, fontWeight: 500 }}
                >
                  {appointment.serviceName}
                </span>
                {appointment.status === "CANCELLED" && (
                  <span className="hint">{copy.cancelled}</span>
                )}
              </div>
              {/* The word says what happened; the strike makes it visible
                  without reading. Not on the label itself, which would be a
                  cancelled cancellation. */}
              <span
                className={appointment.status === "CANCELLED" ? "cancelled hint" : "hint"}
              >
                {formatWhen(appointment)}
              </span>
            </Card>
          ))}
        </div>
      )}

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
