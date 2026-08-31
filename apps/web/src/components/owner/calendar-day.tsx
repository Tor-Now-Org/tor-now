"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  CalendarAppointmentDto,
  CalendarDayDto,
  ResourceDto,
  SlotDto,
} from "@/lib/api/types.ts";
import { formatPrice, timeIn, todayIn } from "@/lib/format.ts";
import { countOf } from "@/lib/i18n/counts.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { DateStrip } from "../date-strip.tsx";
import { Button, Card, Critical, Empty, Note, Sheet, Spinner, Warning } from "../ui.tsx";

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
  const [moving, setMoving] = useState(false);
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSelected(null);
      setMoving(false);
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  /** Reschedule needs times that are free once this appointment is set aside. */
  const loadMoveOptions = async (appointment: CalendarAppointmentDto) => {
    setMoving(true);
    setSlots(null);
    const [available] = await api.availability(business.id, {
      serviceId: appointment.serviceId,
      resourceId: appointment.resourceId,
      from: date,
      to: date,
    });
    setSlots(available?.slots ?? []);
  };

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

      <DateStrip
        from={todayIn(business.timeZone)}
        days={VISIBLE_DAYS}
        selected={date}
        onSelect={setDate}
        todayLabel={copy.today}
        weekdayNames={copy.days}
      />

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
                <span className="tab" style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 15 }}>
                  {timeIn(appointment.startAt, business.timeZone, language)}
                </span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
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

      <Sheet open={selected !== null} onClose={() => { setSelected(null); setMoving(false); }}>
        {selected !== null && !moving && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{copy.whatHappened}</h2>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Detail label={copy.rService} value={selected.serviceName} />
              <Detail
                label={copy.rWhen}
                value={`${timeIn(selected.startAt, business.timeZone, language)}–${timeIn(selected.endAt, business.timeZone, language)}`}
              />
              <Detail label={copy.price} value={formatPrice(selected.priceMinor, language, "—")} />
              <Detail label={copy.searchCustomer} value={`${selected.customerName} · ${selected.customerPhone}`} />
            </Card>

            {selected.status === "NO_SHOW" && <Warning>{copy.noShowNote}</Warning>}
            {selected.status === "CANCELLED" && <Note>{copy.cancelledNote}</Note>}
            {error !== null && <Critical>{error}</Critical>}

            {selected.status === "CONFIRMED" && (
              <>
                <Button onClick={() => void loadMoveOptions(selected)}>{copy.moveAppointment}</Button>
                <Button intent="quiet" onClick={() => act(() => api.markNoShow(token, selected.id))} busy={busy}>
                  {copy.markNoShow}
                </Button>
                <Button intent="danger" onClick={() => act(() => api.cancel(token, selected.id))} busy={busy}>
                  {copy.cancelAppointment}
                </Button>
              </>
            )}

            {selected.status === "NO_SHOW" && (
              <Button intent="quiet" onClick={() => act(() => api.clearNoShow(token, selected.id))} busy={busy}>
                {copy.undoNoShow}
              </Button>
            )}
          </div>
        )}

        {selected !== null && moving && (
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
                    onClick={() => act(() => api.reschedule(token, selected.id, slot.startAt))}
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
    </div>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
    <span className="label" style={{ minWidth: 72 }}>{label}</span>
    <span style={{ fontSize: 14.5 }}>{value}</span>
  </div>
);

const StatusTag = ({
  appointment,
  copy,
}: {
  appointment: CalendarAppointmentDto;
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
    }}
  >
    {text}
  </span>
);
