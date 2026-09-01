"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError, isRecoverableSlotError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  BusinessProfileDto,
  DayAvailabilityDto,
  ResourceDto,
  ServiceDto,
  SlotDto,
} from "@/lib/api/types.ts";
import { formatPrice, timeIn, todayIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { useSession } from "@/lib/session.tsx";
import { DateStrip } from "../date-strip.tsx";
import { SlotGrid } from "../slot-grid.tsx";
import { VerifyPanel } from "../verify-panel.tsx";
import { Button, Card, Critical, Note, Sheet, Spinner, Warning } from "../ui.tsx";

/** How much of the calendar the strip offers at once. */
const VISIBLE_DAYS = 14;

const key = (
  serviceId: string | undefined,
  resourceId: string | undefined,
  date: string | undefined,
): string | null =>
  serviceId === undefined || resourceId === undefined || date === undefined
    ? null
    : `${serviceId}|${resourceId}|${date}`;

type Stage = "choosing" | "confirming" | "verifying" | "done";

export const BookingFlow = ({
  business,
  onFinished,
}: {
  business: BusinessDto;
  onFinished: () => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const { token, user, signIn } = useSession();

  const [profile, setProfile] = useState<BusinessProfileDto | null>(null);
  const [service, setService] = useState<ServiceDto | null>(null);
  const [resource, setResource] = useState<ResourceDto | null>(null);
  const [date, setDate] = useState(() => todayIn(business.timeZone));
  const [day, setDay] = useState<DayAvailabilityDto | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [stage, setStage] = useState<Stage>("choosing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The service, calendar and day the profile response already answered for. */
  const alreadyHave = useRef<string | null>(null);

  useEffect(() => {
    const today = todayIn(business.timeZone);
    api
      .businessProfile(business.id, { from: today, to: today })
      .then((loaded) => {
        setProfile(loaded);
        setService(loaded.services[0] ?? null);
        setResource(loaded.resources[0] ?? null);
        // The first day came back with the profile, so the screen can draw
        // times immediately instead of waiting for a second request. Remember
        // which combination it answered, so the effect below does not
        // immediately ask for the same thing again.
        const first = loaded.availability?.[0];
        if (first !== undefined) {
          setDay(first);
          alreadyHave.current = key(
            loaded.services[0]?.id,
            loaded.resources[0]?.id,
            first.date,
          );
        }
      })
      .catch((cause) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [business.id, business.timeZone, errorText]);

  /**
   * ADR 0003: availability is fetched on demand — when a service or date is
   * chosen, when the customer returns from verifying, and again at
   * confirmation. Nothing polls; correctness rests on the exclusion constraint
   * and on re-validation at the moment of booking.
   */
  const loadDay = useCallback(async () => {
    if (service === null || resource === null) return;
    setBusy(true);
    try {
      const [loaded] = await api.availability(business.id, {
        serviceId: service.id,
        resourceId: resource.id,
        from: date,
        to: date,
      });
      setDay(loaded ?? null);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  }, [business.id, service, resource, date, errorText]);

  useEffect(() => {
    setSlot(null);
    // The profile may already have answered this exact question. Skip it once,
    // then forget — every later change of service, calendar or day is a real
    // request, because availability is never assumed to have stayed still.
    if (alreadyHave.current === key(service?.id, resource?.id, date)) {
      alreadyHave.current = null;
      return;
    }
    void loadDay();
  }, [loadDay, service, resource, date]);

  const confirm = async () => {
    if (service === null || resource === null || slot === null) return;
    if (token === null) {
      setStage("verifying");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.book(token, {
        businessId: business.id,
        serviceId: service.id,
        resourceId: resource.id,
        startAt: slot.startAt,
        customerNote: null,
      });
      setStage("done");
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      if (isRecoverableSlotError(cause)) {
        // The customer keeps the business, the service and the day; only the
        // time is asked again, against a list that is now current.
        setSlot(null);
        setStage("choosing");
        await loadDay();
      }
    } finally {
      setBusy(false);
    }
  };

  if (profile === null) return <Spinner />;

  if (stage === "done") {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }}>
        <div style={{ display: "grid", placeItems: "center", width: 64, height: 64, borderRadius: 999, background: "var(--positive-soft)" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7.5" stroke="var(--positive)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 style={{ fontSize: 22 }}>{copy.done}</h2>
        <p className="hint" style={{ margin: 0 }}>{copy.doneBody}</p>
        <Button onClick={onFinished}>{copy.toMine}</Button>
      </div>
    );
  }

  return (
    <div style={{ padding: "18px 18px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 22 }}>{business.name}</h1>
        {business.address !== null && <span className="hint">{business.address}</span>}
      </div>

      {!business.active && <Warning>{copy.inactiveBanner}</Warning>}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="label">{copy.chooseService}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {profile.services.map((candidate) => {
            const active = candidate.id === service?.id;
            return (
              <button
                key={candidate.id}
                onClick={() => setService(candidate)}
                aria-pressed={active}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "13px 15px",
                  borderRadius: 15,
                  border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                  background: active ? "var(--accent-soft)" : "var(--raised)",
                  textAlign: "start",
                }}
              >
                <span style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{candidate.name}</span>
                <span className="tab hint">
                  {candidate.durationMinutes} {copy.minutes}
                </span>
                <span className="tab" style={{ fontWeight: 600, fontSize: 14.5 }}>
                  {formatPrice(candidate.priceMinor, language, copy.free)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {profile.resources.length > 1 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="label">{copy.chooseResource}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {profile.resources.map((candidate) => (
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
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="label">{copy.chooseTime}</span>
        <DateStrip
          from={todayIn(business.timeZone)}
          days={Math.min(VISIBLE_DAYS, business.bookingHorizonDays)}
          selected={date}
          onSelect={setDate}
          todayLabel={copy.today}
          weekdayNames={copy.days}
        />
        {busy && day === null ? (
          <Spinner />
        ) : day !== null ? (
          <SlotGrid
            day={day}
            timeZone={business.timeZone}
            selected={slot?.startAt ?? null}
            onSelect={(picked) => {
              setSlot(picked);
              setStage("confirming");
            }}
            labels={{
              morning: copy.morning,
              noon: copy.noon,
              evening: copy.evening,
              noTimes: copy.noTimes,
              noTimesBody: copy.noTimesBody,
              callBusiness: copy.callBusiness,
            }}
            businessPhone={business.phone}
          />
        ) : null}
      </section>

      {error !== null && stage === "choosing" && <Critical>{error}</Critical>}

      <Sheet
        open={stage === "confirming" || stage === "verifying"}
        onClose={() => setStage("choosing")}
        labelledBy="confirm-title"
      >
        {stage === "confirming" && slot !== null && service !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 id="confirm-title" style={{ fontSize: 20 }}>{copy.confirmTitle}</h2>
            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Row label={copy.atBusiness} value={business.name} />
              <Row label={copy.service} value={service.name} />
              <Row
                label={copy.when}
                value={`${timeIn(slot.startAt, business.timeZone, language)} · ${new Intl.DateTimeFormat(
                  language === "he" ? "he-IL" : "en-GB",
                  { timeZone: business.timeZone, weekday: "long", day: "numeric", month: "long" },
                ).format(new Date(slot.startAt))}`}
              />
            </Card>
            {token !== null && user !== null && <Note>{copy.stillVerified}</Note>}
            {error !== null && <Critical>{error}</Critical>}
            <Button onClick={confirm} busy={busy}>
              {copy.confirmBooking}
            </Button>
            <Button intent="quiet" onClick={() => setStage("choosing")}>
              {copy.backToTimes}
            </Button>
          </div>
        )}

        {stage === "verifying" && (
          <VerifyPanel
            labels={{
              title: copy.verifyTitle,
              body: copy.verifyBody,
              phoneLabel: copy.phoneLabel,
              sendCode: copy.sendCode,
              codeLabel: copy.codeLabel,
              verify: copy.verify,
              notHeld: copy.notHeld,
              nameTitle: copy.nameTitle,
              nameBody: copy.nameBody,
              firstName: copy.firstName,
              firstPlaceholder: copy.firstPlaceholder,
              lastName: copy.lastName,
              lastPlaceholder: copy.lastPlaceholder,
            }}
            errorText={errorText}
            onVerified={(newToken, newUser) => {
              signIn(newToken, newUser);
              // The slot was never held (ADR 0003), so availability is asked
              // again before the booking is attempted.
              setStage("confirming");
              void loadDay();
            }}
          />
        )}
      </Sheet>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
    <span className="label" style={{ minWidth: 64 }}>{label}</span>
    <span style={{ fontSize: 15, fontWeight: 500 }}>{value}</span>
  </div>
);
