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

type DayHours = {
  open: boolean;
  start: string;
  end: string;
  /** A break splits the day into two ranges; ADR 0002 has no break entity. */
  breakFrom?: string;
  breakTo?: string;
};

/** What the bulk editor is currently set to apply. */
type BulkHours = {
  days: number[];
  start: string;
  end: string;
  withBreak: boolean;
  breakFrom: string;
  breakTo: string;
};

export default function OnboardingPage() {
  const copy = useCopy("onboarding");
  // Signing in is one flow with one set of words, wherever it is reached from.
  const signInCopy = useCopy("signIn");
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
  const [bulk, setBulk] = useState<BulkHours>({
    days: [...DEFAULT_OPEN_DAYS],
    start: DEFAULT_OPENING.start,
    end: DEFAULT_OPENING.end,
    withBreak: false,
    breakFrom: "13:00",
    breakTo: "16:00",
  });
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
            /* This is the same sign-in as everywhere else, so it says the same
               things. Only the title and the reason come from the wizard: what
               was here labelled the phone field "business name" and the code
               field "next", because the onboarding namespace has no sign-in
               copy and something had to be passed. */
            labels={{
              title: copy.wizardTitle,
              body: copy.signInBody,
              phoneLabel: signInCopy.phoneLabel,
              sendCode: signInCopy.sendCode,
              codeLabel: signInCopy.codeTitle,
              verify: signInCopy.enter,
              nameTitle: signInCopy.nameTitle,
              nameBody: signInCopy.nameBody,
              firstName: signInCopy.firstName,
              lastName: signInCopy.lastName,
              saveName: signInCopy.saveName,
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
        workingHours: hours.flatMap((day, dayOfWeek) => rangesFor(day, dayOfWeek)),
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

            {/* Most businesses keep the same hours most days, so the wizard
                offers that first and lets any one day diverge below. */}
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <span className="label">{copy.sameForAll}</span>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="hint">{copy.whichDays}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {copy.dayShort.map((short, dayOfWeek) => {
                    const chosen = bulk.days.includes(dayOfWeek);
                    return (
                      <button
                        key={dayOfWeek}
                        className="chip"
                        aria-pressed={chosen}
                        aria-label={copy.days[dayOfWeek]}
                        onClick={() =>
                          setBulk({
                            ...bulk,
                            days: chosen
                              ? bulk.days.filter((day) => day !== dayOfWeek)
                              : [...bulk.days, dayOfWeek],
                          })
                        }
                        style={{
                          minWidth: 44,
                          padding: "0 10px",
                          background: chosen ? "var(--accent)" : "var(--raised)",
                          color: chosen ? "var(--on-accent)" : "var(--ink)",
                          border: `1px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
                        }}
                      >
                        {short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field id="bulk-from" label={copy.from} type="time" value={bulk.start}
                  onChange={(event) => setBulk({ ...bulk, start: event.target.value })} />
                <Field id="bulk-to" label={copy.to} type="time" value={bulk.end}
                  onChange={(event) => setBulk({ ...bulk, end: event.target.value })} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={bulk.withBreak}
                  onChange={(event) => setBulk({ ...bulk, withBreak: event.target.checked })}
                />
                <span style={{ fontSize: 14.5 }}>{copy.withBreak}</span>
              </label>

              {bulk.withBreak && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field id="break-from" label={copy.breakFrom} type="time" value={bulk.breakFrom}
                    onChange={(event) => setBulk({ ...bulk, breakFrom: event.target.value })} />
                  <Field id="break-to" label={copy.breakTo} type="time" value={bulk.breakTo}
                    onChange={(event) => setBulk({ ...bulk, breakTo: event.target.value })} />
                </div>
              )}

              <Button
                intent="quiet"
                disabled={bulk.days.length === 0 || bulk.end <= bulk.start}
                onClick={() =>
                  setHours(
                    hours.map((day, dayOfWeek) =>
                      bulk.days.includes(dayOfWeek)
                        ? {
                            open: true,
                            start: bulk.start,
                            end: bulk.end,
                            ...(bulk.withBreak
                              ? { breakFrom: bulk.breakFrom, breakTo: bulk.breakTo }
                              : {}),
                          }
                        : day,
                    ),
                  )
                }
              >
                {copy.applyToAll}
              </Button>

              <Note>{copy.perDayNote}</Note>
            </Card>

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
                {day.open && day.breakFrom !== undefined && (
                  <span className="hint">
                    {copy.withBreak}: {day.breakFrom}–{day.breakTo}
                  </span>
                )}
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

/**
 * ADR 0002: the gap between two ranges on a day is the break. A day with a
 * break is therefore two ranges, and nothing else in the system needs to know
 * that a break was what the owner had in mind.
 */
const rangesFor = (
  day: DayHours,
  dayOfWeek: number,
): { dayOfWeek: number; start: string; end: string }[] => {
  if (!day.open) return [];
  if (
    day.breakFrom === undefined ||
    day.breakTo === undefined ||
    day.breakFrom <= day.start ||
    day.breakTo >= day.end ||
    day.breakTo <= day.breakFrom
  ) {
    return [{ dayOfWeek, start: day.start, end: day.end }];
  }
  return [
    { dayOfWeek, start: day.start, end: day.breakFrom },
    { dayOfWeek, start: day.breakTo, end: day.end },
  ];
};

const StepHeading = ({ title, body }: { title: string; body: string }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <h1 style={{ fontSize: 22 }}>{title}</h1>
    <p className="hint" style={{ margin: 0 }}>{body}</p>
  </div>
);
