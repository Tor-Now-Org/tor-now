"use client";

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { deactivationDeadline } from "@/lib/billing-alert.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import { BUSINESS_DEFAULTS, SERVICE_MINUTES, TEXT_RULES, TRIAL_DAYS, type BusinessCategory } from "@tor-now/domain";
import { BufferChoice } from "@/components/owner/buffer-choice.tsx";
import { PhotoPicker, type ChosenPhoto } from "@/components/owner/photo-picker.tsx";
import { AddressAutocomplete } from "@/components/owner/address-autocomplete.tsx";
import { CategoryChooser } from "@/components/category-chooser.tsx";
import { AccountDrawer } from "@/components/account-drawer.tsx";
import { CalendarIcon, PeopleIcon } from "@/components/bottom-nav.tsx";
import {
  blocking,
  checkText,
  useFieldProblem,
} from "@/lib/use-field-problem.ts";
import { checkLocalPhone, fromE164, toE164 } from "@/lib/phone.ts";
import { PhoneField } from "@/components/phone-field.tsx";
import {
  emptyWeek,
  rangesFor,
  WeeklyHours,
  type DayHours,
} from "@/components/owner/weekly-hours.tsx";
import { weekIsUsable } from "@/components/owner/usual-week.ts";
import { Button, Card, Critical, Field, Sheet, Spinner, Warning } from "@/components/ui.tsx";
import { Locked, useLockText } from "@/components/locked.tsx";
import { PlanChoice } from "@/components/plan-choice.tsx";
import { cheapestRoomierThan } from "@/lib/entitlement.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { usePlans } from "@/lib/use-plans.ts";
import { VerifyPanel } from "@/components/verify-panel.tsx";
import { BusinessLive, type OpenedBusiness } from "@/components/owner/business-live.tsx";
import { NumberField } from "@/components/number-field.tsx";
import { ConsentText, useLegalSheet } from "@/components/legal.tsx";
import type { PlanName } from "@/lib/api/types.ts";

// Leaflet reaches for `window`, so the map can only render on the client.
const LocationPicker = dynamic(
  () => import("@/components/owner/location-picker.tsx").then((mod) => mod.LocationPicker),
  { ssr: false },
);

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

const DEFAULT_SERVICE_MINUTES = SERVICE_MINUTES.initial;
/** Sunday to Thursday, the Israeli working week. */
// test

type DraftService = {
  name: string;
  durationMinutes: number;
  priceMinor: number;
  bufferMinutes: number | null;
};

const newService = (): DraftService => ({
  name: "",
  durationMinutes: DEFAULT_SERVICE_MINUTES,
  priceMinor: 0,
  bufferMinutes: null,
});

// useSearchParams needs a Suspense boundary for static rendering.
export default function OnboardingPage() {
  return (
    <Suspense fallback={<Spinner page />}>
      <OnboardingWizard />
    </Suspense>
  );
}

const isPlanName = (value: string | null): value is PlanName => value === "SOLO" || value === "TEAM";

function OnboardingWizard() {
  const copy = useCopy("onboarding");
  // The recovery-time choice is the business panel's, words and all.
  const ownerCopy = useCopy("owner");
  const billingCopy = useCopy("billing");
  const params = useSearchParams();
  const plans = usePlans();
  const locks = useLockText();
  const { language } = useLanguage();
  // Signing in is one flow with one set of words, wherever it is reached from.
  const signInCopy = useCopy("signIn");
  // The account drawer is the same dialog everywhere, so it reuses its copy too.
  const customerCopy = useCopy("customer");
  const router = useRouter();
  const errorText = useErrorText();
  const { token, user, loading, signIn } = useSession();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<readonly BusinessCategory[]>([]);
  const [phone, setPhone] = useState(user !== null ? fromE164(user.phone) : "");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<readonly ChosenPhoto[]>([]);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  // A business pays and holds its customers' data, so it ticks the terms
  // rather than agreeing by carrying on. Asked last, once it knows what it
  // is agreeing to run.
  const [agreed, setAgreed] = useState(false);
  const legal = useLegalSheet();
  const leave = (field: string) =>
    setTouched((previous) => new Set(previous).add(field));
  const problem = useFieldProblem();
  const [resources, setResources] = useState<string[]>([""]);
  const [services, setServices] = useState<DraftService[]>(() => [newService()]);
  const [hours, setHours] = useState<DayHours[]>(emptyWeek);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The business once it is open, as the screen after the wizard summarises it.
  const [opened, setOpened] = useState<OpenedBusiness | null>(null);
  // The plan is chosen once, on the pricing page, and arrives in the address.
  // Without one there is nothing to open a Business on, so the owner is sent
  // to choose it — never asked a second time here.
  const requestedPlan = params.get("plan");
  const [plan, setPlan] = useState<PlanName | null>(isPlanName(requestedPlan) ? requestedPlan : null);
  const [choosingPlan, setChoosingPlan] = useState(false);
  useEffect(() => {
    if (plan === null) router.replace("/pricing");
  }, [plan, router]);

  if (loading || plan === null) return <Spinner page />;

  // Registering a business needs an identity; it is the same sign-in as
  // everything else, so it happens here rather than sending anyone away.
  if (token === null) {
    return (
      <>
        <AppHeader />
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
  const chosen = plans.find((candidate) => candidate.plan === plan) ?? null;
  const named = resources.filter((resource) => resource.trim().length > 0).length;
  // Unknown until the Catalogue answers, and nothing is locked on a guess.
  const allowance = chosen?.resourceAllowance ?? Number.POSITIVE_INFINITY;
  const roomier = cheapestRoomierThan(plans, chosen?.resourceAllowance ?? 0);

  const canContinue =
    step === "details"
      ? !blocking(
          checkText(name, TEXT_RULES.businessName),
          checkLocalPhone(phone),
          checkText(address, TEXT_RULES.address),
          checkText(description, TEXT_RULES.description),
        ) && latitude !== null && longitude !== null && categories.length > 0
      : // Photos are optional, so this step never blocks.
        step === "photos"
        ? true
        : step === "resources"
        ? resources.some((resource) => resource.trim().length > 0) &&
          named <= allowance &&
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
          : // Open somewhere, and every stretch of it readable: a half-typed
            // time would be dropped on the way to the store without a word.
            hours.some((day) => day.open) && weekIsUsable(hours);

  const finish = async () => {
    if (latitude === null || longitude === null || categories.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // The ticked box, recorded against the owner before the business exists.
      await api.acceptTerms(token);
      const named = services
        .filter((service) => service.name.trim().length > 0)
        .map((service) => ({ ...service, name: service.name.trim() }));
      const calendars = resources.map((r) => r.trim()).filter((r) => r.length > 0);
      const business = await api.registerBusiness(token, {
        name: name.trim(),
        phone: toE164(phone),
        address: address.trim(),
        latitude,
        longitude,
        categories: [...categories],
        description: description.trim() === "" ? null : description.trim(),
        plan,
        resourceNames: calendars,
        services: named,
        workingHours: hours.flatMap((day, dayOfWeek) => rangesFor(day, dayOfWeek)),
      });
      // The business exists now, so the held files finally have somewhere to
      // go. A photo that fails to upload is not worth losing the business
      // over: it is registered and bookable either way, and a missing picture
      // is a smaller problem than a wizard that ends in an error after four
      // steps of typing.
      const uploads = await Promise.all(
        photos.map((photo) =>
          api
            .uploadBusinessPhoto(token, business.id, photo.slot, photo.file)
            .then(() => true)
            .catch(() => false),
        ),
      );
      // The Trial's end, as the server set it. Only said on the screen, so a
      // failed read leaves the date off rather than the owner on an error.
      const hadTrial = user?.hadTrial === true;
      const trialEndsOn = hadTrial
        ? null
        : await api
            .subscription(token, business.id)
            .then((billing) => billing.subscription.trialEndsOn)
            .catch(() => null);
      setOpened({
        id: business.id,
        name: business.name,
        category: categories[0] ?? null,
        address: address.trim(),
        services: named,
        calendars,
        hours,
        plan,
        planPriceMinor: chosen?.priceMinor ?? null,
        trialEndsOn,
        payBy: hadTrial ? deactivationDeadline(business.timeZone) : null,
        failedPhotos: uploads.filter((uploaded) => !uploaded).length,
      });
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const accountDrawer = (
    <AccountDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      {...(user === null ? {} : { userName: user.name })}
      labels={{ account: customerCopy.account, signOut: customerCopy.signOut }}
      places={[
        {
          key: "customer",
          title: customerCopy.asCustomer,
          hint: customerCopy.asCustomerHint,
          badge: <CalendarIcon />,
          current: true,
          onClick: () => router.push("/"),
        },
        {
          key: "profile",
          title: customerCopy.profile,
          badge: <PeopleIcon />,
          onClick: () => router.push("/?screen=profile"),
        },
      ]}
      onSignedOut={() => {
        setDrawerOpen(false);
        router.push("/");
      }}
    />
  );

  if (opened !== null) {
    // ADR 0011: open, and in search. Every way off this screen leads into the
    // business, which is where the owner works from now on.
    const intoBusiness = () => router.push(`/manage?business=${opened.id}`);
    return (
      <>
        <AppHeader
          onBack={intoBusiness}
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
        <main className="scroll" style={{ flex: 1, minHeight: 0 }}>
          <BusinessLive business={opened} onDone={intoBusiness} />
        </main>
        {accountDrawer}
      </>
    );
  }

  return (
    <>
      <AppHeader
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

        <div className="plan-line">
          <span>
            {fillText(user?.hadTrial === true ? billingCopy.planLineNoTrial : billingCopy.planLine, {
              plan: billingCopy.plan[plan],
              days: String(TRIAL_DAYS),
            })}
          </span>
          <button type="button" onClick={() => setChoosingPlan(true)}>{billingCopy.change}</button>
        </div>

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
              {/* ADR 0017, 0024: chosen from the list, like the address — required,
                  because browsing by Category only works if everyone has one. */}
              <CategoryChooser
                id="biz-category"
                required
                value={categories}
                language={language}
                onChange={setCategories}
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
              <AddressAutocomplete
                id="biz-address"
                label={copy.address}
                hint={copy.addressHint}
                required
                value={address}
                language={language}
                onSelect={(pickedAddress, lat, lng) => {
                  setAddress(pickedAddress);
                  setLatitude(lat);
                  setLongitude(lng);
                }}
                onClear={() => {
                  setAddress("");
                  setLatitude(null);
                  setLongitude(null);
                }}
              />
              {latitude !== null && longitude !== null && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="label">{copy.locationLabel}</span>
                  <LocationPicker latitude={latitude} longitude={longitude} />
                </div>
              )}
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
            {named > allowance && (
              <Warning>
                {fillText(copy.tooManyCalendars, {
                  plan: billingCopy.plan[plan],
                  n: String(allowance),
                })}
              </Warning>
            )}
            {/* A calendar past what the plan holds is the lock — with the plan
                that has room one tap away, and nothing typed lost. */}
            {resources.length >= allowance ? (
              <Locked
                {...locks.calendar(allowance)}
                {...(roomier === null
                  ? {}
                  : {
                      action: fillText(copy.switchTo, { plan: billingCopy.plan[roomier.plan] }),
                      onAction: () => setPlan(roomier.plan),
                    })}
              />
            ) : (
              <Button intent="quiet" onClick={() => setResources([...resources, ""])}>
                {copy.addBtn}
              </Button>
            )}
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
                  <NumberField
                    id={`service-minutes-${position}`}
                    label={copy.minutes}
                    required
                    value={service.durationMinutes}
                    fallback={DEFAULT_SERVICE_MINUTES}
                    min={SERVICE_MINUTES.min}
                    max={SERVICE_MINUTES.max}
                    onValue={(minutes) =>
                      setServices(services.map((s, i) => (i === position ? { ...s, durationMinutes: minutes ?? DEFAULT_SERVICE_MINUTES } : s)))
                    }
                  />
                  <NumberField
                    id={`service-price-${position}`}
                    label={copy.priceShekels}
                    decimals
                    value={service.priceMinor / 100}
                    fallback={0}
                    onValue={(shekels) =>
                      setServices(services.map((s, i) => (i === position ? { ...s, priceMinor: Math.round((shekels ?? 0) * 100) } : s)))
                    }
                  />
                </div>
                {/* A business opens with no recovery time of its own; the
                    choice says so, and where it can be set later. */}
                <BufferChoice
                  id={`service-buffer-${position}`}
                  durationMinutes={service.durationMinutes}
                  value={service.bufferMinutes}
                  businessDefault={BUSINESS_DEFAULTS.defaultBufferMinutes}
                  onChange={(bufferMinutes) =>
                    setServices(services.map((s, i) => (i === position ? { ...s, bufferMinutes } : s)))
                  }
                  footer={<p className="buffer-sum">{ownerCopy.bufferDefaultLater}</p>}
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
                setServices([...services, newService()])
              }
            >
              {copy.addService}
            </Button>
          </>
        )}

        {step === "hours" && (
          <>
            <StepHeading title={copy.hoursTitle} body={copy.hoursBody} />

            <WeeklyHours hours={hours} setHours={setHours} />

            <label
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: 14,
                borderRadius: 14,
                background: "var(--accent-soft)",
                fontSize: 14,
                lineHeight: 1.6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                style={{ width: 22, height: 22, margin: "1px 0 0", flexShrink: 0, accentColor: "var(--accent)" }}
              />
              <span>
                <ConsentText variant="agree" onOpen={legal.open} />
              </span>
            </label>
            {legal.sheet}
          </>
        )}

        {error !== null && <Critical>{error}</Critical>}

        <Button
          onClick={() =>
            step === "hours" ? void finish() : setStep(STEPS[index + 1] as Step)
          }
          busy={busy}
          disabled={!canContinue || (step === "hours" && !agreed)}
        >
          {step === "hours" ? copy.finish : copy.next}
        </Button>
      </main>
      <Sheet open={choosingPlan} onClose={() => setChoosingPlan(false)} labelledBy="plan-sheet-title">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="plan-sheet-title" style={{ fontSize: 19 }}>{billingCopy.plansHeading}</h2>
          <PlanChoice plans={plans} chosen={plan} name="wizard-plan" onChoose={setPlan} />
          <Button onClick={() => setChoosingPlan(false)}>{billingCopy.choose}</Button>
        </div>
      </Sheet>
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
