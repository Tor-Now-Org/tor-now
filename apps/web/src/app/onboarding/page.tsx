"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import { TEXT_RULES } from "@tor-now/domain";
import { PhotoPicker, type ChosenPhoto } from "@/components/owner/photo-picker.tsx";
import { SignOutButton } from "@/components/sign-out.tsx";
import {
  blocking,
  checkText,
  useFieldProblem,
} from "@/lib/use-field-problem.ts";
import { checkLocalPhone, fromE164, toE164 } from "@/lib/phone.ts";
import { PhoneField } from "@/components/phone-field.tsx";
import {
  DEFAULT_OPENING,
  DEFAULT_OPEN_DAYS,
  rangesFor,
  WeeklyHours,
  type BulkHours,
  type DayHours,
} from "@/components/owner/weekly-hours.tsx";
import { Button, Card, Critical, Field, Sheet, Spinner } from "@/components/ui.tsx";
import { VerifyPanel } from "@/components/verify-panel.tsx";
import type { BusinessDto } from "@/lib/api/types.ts";

/**
 * ADR 0011: a Business is discoverable the moment it registers — there is no
 * approval queue — so this wizard is the whole of onboarding, and its last step
 * puts the business in front of customers.
 *
 * Four of the steps are the four things a Business cannot be booked without:
 * who it is, whose calendar, what it offers, and when it is open. Working Hours
 * are last because they are the only one that actually blocks a booking.
 *
 * Photos are the exception and sit second, next to the rest of what a customer
 * sees. Nothing there is required and the step can be walked straight past —
 * which is why it is before the three that cannot be, rather than a fifth thing
 * standing between an owner and being open.
 */

const STEPS = ["details", "photos", "resources", "services", "hours"] as const;
type Step = (typeof STEPS)[number];

const DEFAULT_SERVICE_MINUTES = 30;
/** Sunday to Thursday, the Israeli working week. */
// test

type DraftService = {
  name: string;
  durationMinutes: number;
  priceMinor: number;
  bufferMinutes: number | null;
};

export default function OnboardingPage() {
  const copy = useCopy("onboarding");
  // Signing in is one flow with one set of words, wherever it is reached from.
  const signInCopy = useCopy("signIn");
  // The account drawer is the same dialog everywhere, so it reuses its copy too.
  const customerCopy = useCopy("customer");
  const router = useRouter();
  const errorText = useErrorText();
  const { token, user, loading, signIn } = useSession();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [owned, setOwned] = useState<BusinessDto[]>([]);
  useEffect(() => {
    if (token === null) {
      setOwned([]);
      return;
    }
    api.myBusinesses(token).then(setOwned).catch(() => setOwned([]));
  }, [token]);

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(user !== null ? fromE164(user.phone) : "");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<readonly ChosenPhoto[]>([]);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const leave = (field: string) =>
    setTouched((previous) => new Set(previous).add(field));
  const problem = useFieldProblem();
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
      ? !blocking(
          checkText(name, TEXT_RULES.businessName),
          checkLocalPhone(phone),
          checkText(address, TEXT_RULES.address),
          checkText(description, TEXT_RULES.description),
        )
      : // Photos are optional, so this step never blocks.
        step === "photos"
        ? true
        : step === "resources"
        ? resources.some((resource) => resource.trim().length > 0) &&
          !blocking(
            ...resources
              .filter((resource) => resource.trim().length > 0)
              .map((resource) => checkText(resource, TEXT_RULES.resourceName)),
          )
        : step === "services"
          ? services.some((service) => service.name.trim().length > 0) &&
            !blocking(
              ...services
                .filter((service) => service.name.trim().length > 0)
                .map((service) => checkText(service.name, TEXT_RULES.serviceName)),
            )
          : hours.some((day) => day.open);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const business = await api.registerBusiness(token, {
        name: name.trim(),
        phone: toE164(phone),
        address: address.trim(),
        description: description.trim() === "" ? null : description.trim(),
        resourceNames: resources.map((r) => r.trim()).filter((r) => r.length > 0),
        services: services
          .filter((service) => service.name.trim().length > 0)
          .map((service) => ({ ...service, name: service.name.trim() })),
        workingHours: hours.flatMap((day, dayOfWeek) => rangesFor(day, dayOfWeek)),
      });
      // The business exists now, so the held files finally have somewhere to
      // go. A photo that fails to upload is not worth losing the business
      // over: it is registered and bookable either way, and a missing picture
      // is a smaller problem than a wizard that ends in an error after four
      // steps of typing.
      await Promise.all(
        photos.map((photo) =>
          api
            .uploadBusinessPhoto(token, business.id, photo.slot, photo.file)
            .catch(() => null),
        ),
      );
      setLive(business.id);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const accountDrawer = (
    <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} labelledBy="drawer-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="drawer-title" style={{ fontSize: 19 }}>{customerCopy.usingAs}</h2>

        <Card style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontWeight: 600 }}>{customerCopy.asCustomer}</span>
          <span className="hint">{customerCopy.asCustomerHint}</span>
        </Card>

        {owned.map((mine) => (
          <Button key={mine.id} onClick={() => router.push(`/manage?business=${mine.id}`)}>
            {customerCopy.manageIt} · {mine.name}
          </Button>
        ))}

        <Button intent="quiet" onClick={() => router.push("/?screen=profile")}>
          {customerCopy.profile}
        </Button>
        <SignOutButton
          label={customerCopy.signOut}
          onSignedOut={() => {
            setDrawerOpen(false);
            router.push("/");
          }}
        />
      </div>
    </Sheet>
  );

  if (live !== null) {
    return (
      <>
        <AppHeader
          languageLabel={copy.langSwitch}
          onBack={() => router.push("/")}
          backLabel={copy.back}
          trailing={
            user !== null ? (
              <AccountButton
                initial={user.name.trim().charAt(0) || "?"}
                onClick={() => setDrawerOpen(true)}
                label={copy.account}
              />
            ) : null
          }
        />
        <main className="scroll" style={{ flex: 1, padding: "40px 20px", display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }}>
          <span className="chip" style={{ background: "var(--positive-soft)", color: "var(--positive)", border: "1px solid var(--positive)" }}>
            {copy.live}
          </span>
          <h1 style={{ fontSize: 24 }}>{name}</h1>
          <p className="hint" style={{ margin: 0 }}>{copy.liveBody}</p>
          <Button onClick={() => router.push(`/manage?business=${live}`)}>{copy.done}</Button>
        </main>
        {accountDrawer}
      </>
    );
  }

  return (
    <>
      <AppHeader
        languageLabel={copy.langSwitch}
        title={copy.wizardTitle}
        onBack={index > 0 ? () => setStep(STEPS[index - 1] as Step) : () => router.push("/")}
        backLabel={copy.back}
        trailing={
          user !== null ? (
            <AccountButton
              initial={user.name.trim().charAt(0) || "?"}
              onClick={() => setDrawerOpen(true)}
              label={copy.account}
            />
          ) : null
        }
      />

      <main className="scroll" style={{ flex: 1, minHeight: 0, padding: "20px 18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
        <span className="label">
          {copy.stepOf} {index + 1} {copy.of} {STEPS.length}
        </span>

        {step === "details" && (
          <>
            <StepHeading title={copy.detailsTitle} body={copy.detailsBody} />
            <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field
                id="biz-name"
                label={copy.bizName}
                required
                value={name}
                problem={problem.text(name, TEXT_RULES.businessName, touched.has("name"))}
                onBlur={() => leave("name")}
                onChange={(e) => setName(e.target.value)}
              />
              <PhoneField
                id="biz-phone"
                label={signInCopy.phoneLabel}
                required
                value={phone}
                showProblem={touched.has("phone")}
                onBlur={() => leave("phone")}
                onChange={setPhone}
              />
              <Field
                id="biz-address"
                label={copy.address}
                required
                value={address}
                problem={problem.text(address, TEXT_RULES.address, touched.has("address"))}
                onBlur={() => leave("address")}
                onChange={(e) => setAddress(e.target.value)}
              />
              {/* Optional, and said to be: a business that has nothing to add
                  should not feel it has left something blank. */}
              <Field
                id="biz-description"
                label={copy.bizDescription}
                hint={copy.bizDescriptionHint}
                value={description}
                problem={problem.text(description, TEXT_RULES.description, touched.has("description"))}
                onBlur={() => leave("description")}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Card>
          </>
        )}

        {step === "photos" && (
          <div className="stack" style={{ gap: 16 }}>
            <StepHeading title={copy.photosTitle} body={copy.photosBody} />
            <PhotoPicker
              chosen={photos}
              onChange={setPhotos}
              labels={{
                cover: copy.photoCover,
                coverHint: copy.photoCoverHint,
                more: copy.photoMore,
                moreHint: copy.photoMoreHint,
                add: copy.photoAdd,
                replace: copy.photoReplace,
                remove: copy.photoRemove,
                notAnImage: copy.photoNotAnImage,
              }}
            />
          </div>
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
                    required
                    value={resource}
                    problem={problem.text(
                      resource,
                      TEXT_RULES.resourceName,
                      touched.has(`resource-${position}`) && resource.trim() !== "",
                    )}
                    onBlur={() => leave(`resource-${position}`)}
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
                  required
                  placeholder={copy.serviceNamePlaceholder}
                  value={service.name}
                  problem={problem.text(
                    service.name,
                    TEXT_RULES.serviceName,
                    touched.has(`service-${position}`) && service.name.trim() !== "",
                  )}
                  onBlur={() => leave(`service-${position}`)}
                  onChange={(event) =>
                    setServices(services.map((s, i) => (i === position ? { ...s, name: event.target.value } : s)))
                  }
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field
                    id={`service-minutes-${position}`}
                    label={copy.minutes}
                    required
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
                    required
                    type="number"
                    inputMode="numeric"
                    value={service.priceMinor / 100}
                    onChange={(event) =>
                      setServices(services.map((s, i) => (i === position ? { ...s, priceMinor: Math.round(Number(event.target.value) * 100) } : s)))
                    }
                  />
                </div>
                <Field
                  id={`service-buffer-${position}`}
                  label={copy.buffer}
                  hint={copy.bufferHint}
                  type="number"
                  inputMode="numeric"
                  value={service.bufferMinutes ?? ""}
                  placeholder={copy.defaultBuffer}
                  onChange={(event) =>
                    setServices(
                      services.map((s, i) =>
                        i === position
                          ? { ...s, bufferMinutes: event.target.value === "" ? null : Number(event.target.value) }
                          : s,
                      ),
                    )
                  }
                />
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

            <WeeklyHours hours={hours} setHours={setHours} bulk={bulk} setBulk={setBulk} />
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
      {accountDrawer}
    </>
  );
}

/**
 * ADR 0002: the gap between two ranges on a day is the break. A day with a
 * break is therefore two ranges, and nothing else in the system needs to know
 * that a break was what the owner had in mind.
 */
const StepHeading = ({ title, body }: { title: string; body: string }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <h1 style={{ fontSize: 22 }}>{title}</h1>
    <p className="hint" style={{ margin: 0 }}>{body}</p>
  </div>
);
