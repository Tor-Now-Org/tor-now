"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { Button, Card, Critical, Field, Note, Spinner } from "@/components/ui.tsx";
import { VerifyPanel } from "@/components/verify-panel.tsx";

/**
 * ADR 0011: a Business is discoverable the moment it registers — there is no
 * approval queue — so this wizard is the whole of onboarding, and its last step
 * puts the business in front of customers.
 *
 * The four steps are the four things a Business cannot be booked without: who
 * it is, whose calendar, what it offers, and when it is open. Working Hours are
 * last because they are the only one that actually blocks a booking.
 */

const STEPS = ["details", "resources", "services", "hours"] as const;
type Step = (typeof STEPS)[number];

const DEFAULT_SERVICE_MINUTES = 30;
const DEFAULT_OPENING = { start: "09:00", end: "17:00" };
/** Sunday to Thursday, the Israeli working week. */
const DEFAULT_OPEN_DAYS = [0, 1, 2, 3, 4];

type DraftService = {
  name: string;
  durationMinutes: number;
  priceMinor: number;
  bufferMinutes: number | null;
};

type DayHours = { open: boolean; start: string; end: string };

export default function OnboardingPage() {
  const copy = useCopy("onboarding");
  const router = useRouter();
  const errorText = useErrorText();
  const { token, user, loading, signIn } = useSession();

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(user?.phone ?? "+972");
  const [address, setAddress] = useState("");
  const [resources, setResources] = useState<string[]>([""]);
  const [services, setServices] = useState<DraftService[]>([
    { name: "", durationMinutes: DEFAULT_SERVICE_MINUTES, priceMinor: 0, bufferMinutes: null },
  ]);
  const [hours, setHours] = useState<DayHours[]>(() =>
    Array.from({ length: 7 }, (_unused, day) => ({
      open: DEFAULT_OPEN_DAYS.includes(day),
      ...DEFAULT_OPENING,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);

  if (loading) return <Spinner />;

  // Registering a business needs an identity; it is the same sign-in as
  // everything else, so it happens here rather than sending anyone away.
  if (token === null) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} />
        <main className="scroll" style={{ flex: 1, padding: "28px 20px" }}>
          <VerifyPanel
            labels={{
              title: copy.wizardTitle,
              body: copy.detailsBody,
              phoneLabel: copy.bizName,
              sendCode: copy.next,
              codeLabel: copy.next,
              verify: copy.next,
              nameTitle: copy.detailsTitle,
              nameBody: copy.detailsBody,
              firstName: copy.bizName,
              firstPlaceholder: copy.serviceNamePlaceholder,
            }}
            errorText={errorText}
            onVerified={signIn}
          />
        </main>
      </>
    );
  }

  const index = STEPS.indexOf(step);

  const canContinue =
    step === "details"
      ? name.trim().length >= 2 && /^\+[1-9]\d{7,14}$/.test(phone.trim())
      : step === "resources"
        ? resources.some((resource) => resource.trim().length > 0)
        : step === "services"
          ? services.some((service) => service.name.trim().length > 0)
          : hours.some((day) => day.open);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const business = await api.registerBusiness(token, {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim() === "" ? null : address.trim(),
        description: null,
        resourceNames: resources.map((r) => r.trim()).filter((r) => r.length > 0),
        services: services
          .filter((service) => service.name.trim().length > 0)
          .map((service) => ({ ...service, name: service.name.trim() })),
        workingHours: hours.flatMap((day, dayOfWeek) =>
          day.open ? [{ dayOfWeek, start: day.start, end: day.end }] : [],
        ),
      });
      setLive(business.id);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (live !== null) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} />
        <main className="scroll" style={{ flex: 1, padding: "40px 20px", display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }}>
          <span className="chip" style={{ background: "var(--positive-soft)", color: "var(--positive)", border: "1px solid var(--positive)" }}>
            {copy.live}
          </span>
          <h1 style={{ fontSize: 24 }}>{name}</h1>
          <p className="hint" style={{ margin: 0 }}>{copy.liveBody}</p>
          <Button onClick={() => router.push(`/manage?business=${live}`)}>{copy.done}</Button>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader
        languageLabel={copy.langSwitch}
        title={copy.wizardTitle}
        {...(index > 0
          ? { onBack: () => setStep(STEPS[index - 1] as Step), backLabel: copy.back }
          : {})}
      />

      <main className="scroll" style={{ flex: 1, minHeight: 0, padding: "20px 18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
        <span className="label">
          {copy.stepOf} {index + 1} {copy.of} {STEPS.length}
        </span>

        {step === "details" && (
          <>
            <StepHeading title={copy.detailsTitle} body={copy.detailsBody} />
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field id="biz-name" label={copy.bizName} value={name} onChange={(e) => setName(e.target.value)} />
              <Field id="biz-phone" label="טלפון" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Field id="biz-address" label={copy.address} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Card>
            <Note>{copy.noQueue}</Note>
          </>
        )}

        {step === "resources" && (
          <>
            <StepHeading title={copy.resourcesTitle} body={copy.resourcesBody} />
            {resources.map((resource, position) => (
              <Card key={position} style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Field
                    id={`resource-${position}`}
                    label={copy.calendarName}
                    value={resource}
                    onChange={(event) =>
                      setResources(resources.map((r, i) => (i === position ? event.target.value : r)))
                    }
                  />
                </div>
                {resources.length > 1 && (
                  <button
                    onClick={() => setResources(resources.filter((_r, i) => i !== position))}
                    style={{ color: "var(--critical)", fontSize: 13, minHeight: 44 }}
                  >
                    {copy.remove}
                  </button>
                )}
              </Card>
            ))}
            <Button intent="quiet" onClick={() => setResources([...resources, ""])}>
              {copy.addBtn}
            </Button>
          </>
        )}

        {step === "services" && (
          <>
            <StepHeading title={copy.servicesTitle} body={copy.servicesBody} />
            {services.map((service, position) => (
              <Card key={position} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field
                  id={`service-name-${position}`}
                  label={copy.serviceName}
                  placeholder={copy.serviceNamePlaceholder}
                  value={service.name}
                  onChange={(event) =>
                    setServices(services.map((s, i) => (i === position ? { ...s, name: event.target.value } : s)))
                  }
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field
                    id={`service-minutes-${position}`}
                    label={copy.minutes}
                    type="number"
                    inputMode="numeric"
                    value={service.durationMinutes}
                    onChange={(event) =>
                      setServices(services.map((s, i) => (i === position ? { ...s, durationMinutes: Number(event.target.value) } : s)))
                    }
                  />
                  <Field
                    id={`service-price-${position}`}
                    label={copy.priceShekels}
                    type="number"
                    inputMode="numeric"
                    value={service.priceMinor / 100}
                    onChange={(event) =>
                      setServices(services.map((s, i) => (i === position ? { ...s, priceMinor: Math.round(Number(event.target.value) * 100) } : s)))
                    }
                  />
                </div>
                {services.length > 1 && (
                  <button
                    onClick={() => setServices(services.filter((_s, i) => i !== position))}
                    style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}
                  >
                    {copy.remove}
                  </button>
                )}
              </Card>
            ))}
            <Button
              intent="quiet"
              onClick={() =>
                setServices([...services, { name: "", durationMinutes: DEFAULT_SERVICE_MINUTES, priceMinor: 0, bufferMinutes: null }])
              }
            >
              {copy.addService}
            </Button>
          </>
        )}

        {step === "hours" && (
          <>
            <StepHeading title={copy.hoursTitle} body={copy.hoursBody} />
            {hours.map((day, dayOfWeek) => (
              <Card key={dayOfWeek} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(event) =>
                      setHours(hours.map((d, i) => (i === dayOfWeek ? { ...d, open: event.target.checked } : d)))
                    }
                  />
                  <span style={{ flex: 1, fontWeight: 500 }}>{copy.days[dayOfWeek]}</span>
                  <span className="hint">{day.open ? copy.open : copy.closed}</span>
                </label>
                {day.open && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Field
                      id={`from-${dayOfWeek}`}
                      label={copy.from}
                      type="time"
                      value={day.start}
                      onChange={(event) =>
                        setHours(hours.map((d, i) => (i === dayOfWeek ? { ...d, start: event.target.value } : d)))
                      }
                    />
                    <Field
                      id={`to-${dayOfWeek}`}
                      label={copy.to}
                      type="time"
                      value={day.end}
                      onChange={(event) =>
                        setHours(hours.map((d, i) => (i === dayOfWeek ? { ...d, end: event.target.value } : d)))
                      }
                    />
                  </div>
                )}
              </Card>
            ))}
            <Note>{copy.perDayNote}</Note>
          </>
        )}

        {error !== null && <Critical>{error}</Critical>}

        <Button
          onClick={() =>
            step === "hours" ? void finish() : setStep(STEPS[index + 1] as Step)
          }
          busy={busy}
          disabled={!canContinue}
        >
          {step === "hours" ? copy.finish : copy.next}
        </Button>
      </main>
    </>
  );
}

const StepHeading = ({ title, body }: { title: string; body: string }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <h1 style={{ fontSize: 22 }}>{title}</h1>
    <p className="hint" style={{ margin: 0 }}>{body}</p>
  </div>
);
