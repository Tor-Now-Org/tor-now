"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError, isRecoverableSlotError } from "@/lib/api/errors.ts";
import type {
  AppointmentDto,
  WaitingDto,
  BusinessDto,
  BusinessProfileDto,
  DayAvailabilityDto,
  ResourceDto,
  ServiceDto,
  SlotDto,
} from "@/lib/api/types.ts";
import { distanceKm, distanceLabel } from "@/lib/distance.ts";
import {
  countdownTo,
  formatLocalDate,
  formatPrice,
  timeIn,
  todayIn,
  type PartOfDay,
} from "@/lib/format.ts";
import { fillParts } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { CategoryTags } from "./category-tag.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { useSession } from "@/lib/session.tsx";
import { LogoMark } from "../logo.tsx";
import { VerifyPanel } from "../verify-panel.tsx";
import { BusinessPhotos } from "./business-photos.tsx";
import { ReviewPrompt, ReviewSummary, useBusinessReviews } from "./business-reviews.tsx";
import { WaitSheet } from "./wait-sheet.tsx";
import { lastBookableDay, stripDates } from "./days-model.ts";
import { useChoosingDay } from "./use-choosing-day.ts";
import { WhenSection } from "./when-section.tsx";
import { Button, Card, Critical, MultilineField, Sheet, Spinner, Warning } from "../ui.tsx";

type Stage = "choosing" | "confirming" | "verifying" | "done" | "cancelled";

/** Error details are unknown by type; take a string only when it is one. */
const aString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/** What the API accepts on customerNote; said here so the field can stop there. */
const NOTE_LIMIT = 500;

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
  const { token, signIn } = useSession();
  const reviews = useBusinessReviews(business.id);

  const [profile, setProfile] = useState<BusinessProfileDto | null>(null);
  const [service, setService] = useState<ServiceDto | null>(null);
  const [resource, setResource] = useState<ResourceDto | null>(null);
  /** The first two weeks the business page already carried, for the first service and calendar. */
  const [seed, setSeed] = useState<{
    serviceId: string;
    resourceId: string;
    days: readonly DayAvailabilityDto[];
  } | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [stage, setStage] = useState<Stage>("choosing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** Briefly true after the address is copied, where there is no share sheet. */
  const [shared, setShared] = useState(false);
  /**
   * ADR 0018. Which empty stretch the customer pressed "tell me" on, or null
   * for the whole day. Undefined means the sheet is closed — distinct from
   * null, which is a real answer.
   */
  const [waitingFor, setWaitingFor] = useState<PartOfDay | null | undefined>(undefined);
  /** What this customer already has standing at this business. */
  const [waiting, setWaiting] = useState<readonly WaitingDto[]>([]);

  const showError = useCallback(
    (cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")),
    [errorText],
  );
  /** ADR 0026: the days, what each holds, and which one is being looked at. */
  const chooser = useChoosingDay({
    business,
    serviceId: service?.id ?? null,
    resourceId: resource?.id ?? null,
    seed,
    onError: showError,
  });
  const { date } = chooser;


  /**
   * What is standing for this Service on the day being looked at. One entry per
   * Service per day is all the product allows, so this is the one the screen
   * is about — and what the grid draws its buttons from.
   */
  const standing =
    service === null
      ? null
      : (waiting.find(
          (entry) => entry.onDate === date && entry.serviceId === service.id,
        ) ?? null);
  const standingParts: readonly PartOfDay[] =
    standing === null
      ? []
      : standing.parts.map((part) =>
          part === "MORNING" ? "morning" : part === "NOON" ? "noon" : "evening",
        );

  /**
   * As a given session, not only the current one: right after verifying, the
   * new token is in hand before the session around this screen has caught up.
   */
  const loadWaiting = useCallback(async (as: string | null = token) => {
    if (as === null) {
      setWaiting([]);
      return;
    }
    try {
      // This shop's worth, asked for as such: taking the customer's whole list
      // and keeping one shop's rows meant the other shops' standing requests
      // reached this page only to be thrown away.
      setWaiting(await api.myWaiting(as, business.id));
    } catch {
      // The list is an embellishment on a screen that works without it: a
      // failure here must not stop somebody booking.
      setWaiting([]);
    }
  }, [token, business.id]);

  useEffect(() => {
    void loadWaiting();
  }, [loadWaiting]);

  /**
   * What a visitor asked to wait for, kept while they verify. Without it the
   * ask was dropped at the verification step, and they came back signed in to
   * an empty booking sheet with the offer still unanswered.
   */
  const waitAfterVerifying = useRef<((token: string) => Promise<void>) | null>(null);

  /**
   * Join, change or leave — all three are the same shape: do it, say so, and
   * re-read the list so the screen matches what the server now holds.
   */
  const keepWaiting = async (change: (token: string) => Promise<void>, as: string | null = token) => {
    if (as === null) {
      waitAfterVerifying.current = change;
      setWaitingFor(undefined);
      setStage("verifying");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await change(as);
      setWaitingFor(undefined);
      await loadWaiting(as);
    } catch (trouble) {
      setError(errorText(isApiError(trouble) ? trouble.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };
  /** Kilometres from the customer, when both they and the pin are known. */
  const [distance, setDistance] = useState<number | null>(null);
  useEffect(() => {
    const { latitude, longitude } = business;
    if (latitude == null || longitude == null || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setDistance(distanceKm(position.coords, { latitude, longitude })),
      () => {
        // Denied or unavailable: no distance shown.
      },
      { timeout: 8000 },
    );
  }, [business]);
  /**
   * The question the API came back with, if it came back with one. Two things
   * can be worth stopping over — another of the same service today, and a time
   * that runs across an appointment held elsewhere — and either can follow the
   * other, so each is asked and answered on its own.
   */
  const [question, setQuestion] = useState<
    | {
        kind: "SAME_SERVICE" | "OVERLAP";
        businessName: string;
        serviceName: string;
        resourceName: string;
        startAt: string;
        endAt: string;
        date: string;
      }
    | null
  >(null);
  /** The answers given so far, carried into every following attempt. */
  const [answered, setAnswered] = useState({ sameService: false, overlap: false });
  /** What was just booked, kept for the done screen and the cancel on it. */
  const [booked, setBooked] = useState<AppointmentDto | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const today = todayIn(business.timeZone);
    // ADR 0026: the business page carries the first two weeks for the first
    // service and calendar, so the days can say what they hold at once.
    const lastDay = lastBookableDay(new Date(), business.timeZone, business.bookingHorizonDays);
    const firstPage = stripDates(today, lastDay, null);
    api
      .businessProfile(business.id, { from: firstPage[0]!, to: firstPage.at(-1)! })
      .then((loaded) => {
        setProfile(loaded);
        const firstService = loaded.services[0] ?? null;
        const firstResource = loaded.resources[0] ?? null;
        setService(firstService);
        setResource(firstResource);
        if (firstService !== null && firstResource !== null && loaded.availability !== undefined) {
          setSeed({ serviceId: firstService.id, resourceId: firstResource.id, days: loaded.availability });
        }
      })
      .catch((cause) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [business.id, business.timeZone, business.bookingHorizonDays, errorText]);

  useEffect(() => {
    setSlot(null);
    // A booking error belongs to the choice that produced it; changing the
    // service, calendar or day makes it stale.
    setError(null);
  }, [service, resource, date]);

  /**
   * `answers` carries what the customer has already said yes to. Both are false
   * on a first attempt, so it stops and asks; each answer given is kept for
   * every attempt after it, since a second question does not withdraw the first
   * answer.
   */
  const confirm = async (answers = answered) => {
    if (service === null || resource === null || slot === null) return;
    if (token === null) {
      // Verifying to book: whatever wait was asked for and walked away from
      // stays unasked.
      waitAfterVerifying.current = null;
      setStage("verifying");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await api.book(token, {
        businessId: business.id,
        serviceId: service.id,
        resourceId: resource.id,
        startAt: slot.startAt,
        customerNote: note.trim() === "" ? null : note.trim(),
        ...(answers.sameService ? { bookingAnotherOfTheSame: true } : {}),
        ...(answers.overlap ? { bookingOverAnother: true } : {}),
      });
      setBooked(made);
      setStage("done");
    } catch (cause) {
      const asking =
        isApiError(cause) && cause.code === "ALREADY_BOOKED_THAT_DAY"
          ? "SAME_SERVICE"
          : isApiError(cause) && cause.code === "OVERLAPS_ANOTHER_APPOINTMENT"
            ? "OVERLAP"
            : null;
      if (asking !== null && isApiError(cause)) {
        // Not a refusal but a question, so it is put as one rather than shown
        // as an error the customer can do nothing about.
        setQuestion({
          kind: asking,
          businessName: aString(cause.details["businessName"], business.name),
          serviceName: aString(cause.details["serviceName"], service.name),
          resourceName: aString(cause.details["resourceName"], ""),
          startAt: aString(cause.details["startAt"], ""),
          endAt: aString(cause.details["endAt"], ""),
          date: aString(cause.details["date"], ""),
        });
        setBusy(false);
        return;
      }
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      if (isRecoverableSlotError(cause)) {
        // The customer keeps the business, the service and the day; only the
        // time is asked again, against a list that is now current.
        setSlot(null);
        setStage("choosing");
        await chooser.refreshDay();
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Yes to the question on screen. The answer is kept — a second question is
   * asked of the same attempt, and answering it must not un-answer the first —
   * and the booking is attempted again with both.
   */
  const answer = async () => {
    if (question === null) return;
    const given =
      question.kind === "SAME_SERVICE"
        ? { ...answered, sameService: true }
        : { ...answered, overlap: true };
    setAnswered(given);
    setQuestion(null);
    await confirm(given);
  };

  /**
   * When the appointment they already hold is: the day, then the clock. The
   * overlapping one is shown as a span, since "runs across yours" is the whole
   * point and a start alone does not show it. Read in this business's time
   * zone, which is the clock the customer is looking at.
   */
  const whenOf = (asked: NonNullable<typeof question>) => {
    const day = formatLocalDate(asked.date, language, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (asked.startAt === "") return day;
    const from = timeIn(asked.startAt, business.timeZone, language);
    const until =
      asked.kind === "OVERLAP" && asked.endAt !== ""
        ? `–${timeIn(asked.endAt, business.timeZone, language)}`
        : "";
    return `${day} ${copy.atTime} ${from}${until}`;
  };

  if (profile === null) return <Spinner page />;

  /**
   * Absent and empty both mean "this business has none". An API deployed before
   * these fields existed sends neither key, and a preview pointed at it would
   * otherwise crash on a `.replace` of undefined rather than simply showing
   * nothing.
   */
  /**
   * Hand the business's own address to whatever the device shares with. The
   * page is reachable cold at /business/<id>, which is what makes this worth
   * offering at all — a link that only works for someone already inside the app
   * is not a link.
   */
  const share = async () => {
    const url = `${window.location.origin}/business/${business.id}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: business.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // A cancelled share sheet and a refused clipboard both land here, and
      // neither is a failure worth a message: the person either changed their
      // mind or can select the address from the bar themselves.
    }
  };

  const said = (value: string | null | undefined): string | null =>
    value === null || value === undefined || value.trim() === "" ? null : value;
  const instagram = said(business.instagram);
  const whatsapp = said(business.whatsapp);
  /** Same pin the owner placed on the map at onboarding, so a customer opens
      exactly where it points rather than wherever a text address geocodes to. */
  const mapsHref =
    business.latitude != null && business.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${business.latitude},${business.longitude}`
      : null;

  /**
   * Taken back from the screen that made it. The Cancellation Window warns, it
   * never forbids, so the button is always there and only the warning depends
   * on the clock — the same rule as on My appointments.
   */
  const cancelBooked = async () => {
    if (token === null || booked === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancel(token, booked.id);
      setCancelling(false);
      setBooked(null);
      setSlot(null);
      setStage("cancelled");
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (stage === "cancelled") {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center" }}>
        <h2 style={{ fontSize: 22 }}>{copy.cancelledTitle}</h2>
        <p className="hint" style={{ margin: 0 }}>{copy.cancelledBody}</p>
        <Button
          onClick={() => {
            setStage("choosing");
            // The time just given back is free again: the day is read anew.
            void chooser.refreshDay();
          }}
        >
          {copy.pickAnotherTime}
        </Button>
        <Button intent="quiet" onClick={onFinished}>{copy.toMine}</Button>
      </div>
    );
  }

  if (stage === "done" && booked !== null) {
    const day = new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
      timeZone: business.timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const span = `${timeIn(booked.startAt, business.timeZone, language)}–${timeIn(booked.endAt, business.timeZone, language)}`;
    // Where the Cancellation Window opens. Zero means the business asks for no
    // notice, and then there is no "until" worth naming.
    const windowOpens =
      business.cancellationWindowHours > 0
        ? new Date(new Date(booked.startAt).getTime() - business.cancellationWindowHours * 3_600_000)
        : null;
    const late = windowOpens !== null && windowOpens.getTime() <= Date.now();
    const untilText =
      windowOpens === null
        ? null
        : `${new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
            timeZone: business.timeZone,
            weekday: "short",
            day: "numeric",
            month: "numeric",
          }).format(windowOpens)}, ${timeIn(windowOpens.toISOString(), business.timeZone, language)}`;
    const calendarHref = `https://calendar.google.com/calendar/render?${new URLSearchParams({
      action: "TEMPLATE",
      text: `${booked.serviceName} - ${business.name}`,
      dates: [booked.startAt, booked.endAt]
        .map((iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"))
        .join("/"),
    })}`;
    const tick = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
    const step = (done: boolean, title: string, detail: string, last = false, action?: ReactNode) => (
      <li style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, position: "relative", paddingBottom: last ? 0 : 14 }}>
        {!last && (
          <span aria-hidden="true" style={{ position: "absolute", insetInlineStart: 10, top: 22, bottom: 0, width: 2, background: "var(--line)" }} />
        )}
        <span
          style={{
            width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center",
            border: `2px solid ${done ? "var(--positive)" : "var(--line)"}`,
            background: done ? "var(--positive)" : "var(--raised)",
          }}
        >
          {done && tick}
        </span>
        <div>
          <b style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{title}</b>
          <span className="hint" style={{ fontSize: 12.5, display: "block" }}>{detail}</span>
          {action}
        </div>
      </li>
    );

    return (
      <div className="booked">
        <div className="booked-hero">
          <span
            style={{
              alignSelf: "start", display: "inline-flex", alignItems: "center", gap: 6,
              background: "oklch(100% 0 0 / .12)", borderRadius: 999, padding: "4px 10px 4px 8px",
              fontSize: 12.5, fontWeight: 600,
            }}
          >
            <span style={{ width: 16, height: 16, borderRadius: 999, background: "var(--cyan)", display: "grid", placeItems: "center" }}>
              {tick}
            </span>
            {copy.done}
          </span>
          {/* "In 2 days" is the answer; the date under it is the proof. */}
          <h2 className="booked-countdown">
            {countdownTo(booked.startAt, language)}
          </h2>
          <span className="tab" style={{ opacity: 0.85, fontSize: 15 }}>
            {day.format(new Date(booked.startAt))} · {span}
          </span>
          {/* Each action sits beside what it acts on: the calendar by the date,
              directions by the address, cancelling by its deadline. */}
          <a className="booked-action on-navy" href={calendarHref} target="_blank" rel="noreferrer">
            <CalendarPlusIcon />
            {copy.addToCalendar}
          </a>
        </div>

        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Row label={copy.atBusiness} value={business.name} />
          <Row label={copy.service} value={booked.serviceName} />
          {booked.resourceName != null && booked.resourceName !== "" && (
            <Row label={copy.who} value={booked.resourceName} />
          )}
          {service !== null && (
            <Row label={copy.priceLabel} value={formatPrice(service.priceMinor, language, copy.free)} />
          )}
          {(business.address !== null || mapsHref !== null) && (
            <Row
              label={copy.where}
              value={business.address ?? ""}
              action={
                mapsHref !== null && (
                  <a className="booked-action" href={mapsHref} target="_blank" rel="noreferrer">
                    <PinIcon />
                    {copy.directions}
                  </a>
                )
              }
            />
          )}
          {booked.customerNote !== null && booked.customerNote !== "" && (
            <Row label={copy.customerNote} value={booked.customerNote} />
          )}
        </Card>

        <div className="booked-side">
        <Card>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {step(true, copy.doneSent, copy.doneSentWhen)}
            {step(
              false,
              untilText !== null && !late ? copy.freeToCancelUntil : copy.cancelAnyTime,
              untilText !== null && !late ? untilText : copy.toMine,
              true,
              <button className="booked-cancel" onClick={() => setCancelling(true)}>
                {copy.cancelAppointment}
              </button>,
            )}
          </ol>
        </Card>
        </div>

        {/* The way forward, pinned above the bottom bar on a phone. */}
        <div className="booked-go">
          <Button onClick={onFinished}>{copy.toMine}</Button>
        </div>

        <Sheet open={cancelling} onClose={() => setCancelling(false)} labelledBy="cancel-booked-title">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="cancel-booked-title" style={{ fontSize: 20 }}>{copy.cancelAppointment}</h2>
            <p className="hint tab" style={{ margin: 0 }}>
              {booked.serviceName} · {day.format(new Date(booked.startAt))} · {span}
            </p>
            {late && <Warning>{copy.lateWarning}</Warning>}
            {error !== null && <Critical>{error}</Critical>}
            <Button intent="danger" onClick={() => void cancelBooked()} busy={busy}>
              {copy.cancelAppointment}
            </Button>
            <Button intent="quiet" onClick={() => setCancelling(false)}>
              {copy.keepIt}
            </Button>
          </div>
        </Sheet>
      </div>
    );
  }

  return (
    <div style={{ padding: "18px 18px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
      <BusinessPhotos
        photos={profile.photos}
        businessName={business.name}
        labels={{
          gallery: copy.photosOf,
          showPhoto: copy.showPhoto,
          previousPhoto: copy.previousPhoto,
          nextPhoto: copy.nextPhoto,
          enlargePhoto: copy.enlargePhoto,
          closePhoto: copy.closePhoto,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 22 }}>{business.name}</h1>
        <CategoryTags business={business} language={language} />
        {business.address !== null && <span className="hint">{business.address}</span>}
        {reviews.average !== null && reviews.held !== null && (
          <a href="#reviews" className="hint" style={{ alignSelf: "start", color: "var(--muted)" }}>
            <span style={{ color: "var(--caution)" }} aria-hidden="true">★</span>{" "}
            {reviews.average.toFixed(1)} ·{" "}
            {fillParts(copy.reviewsTotal, { count: String(reviews.held.reviews.length) })
              .map((part) => part.text)
              .join("")}
          </a>
        )}
        {distance !== null && (
          <span
            style={{
              alignSelf: "start",
              marginTop: 4,
              fontSize: 11.5,
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 999,
              background: "var(--accent-soft)",
              color: "var(--accent-strong)",
            }}
          >
            {distanceLabel(distance, copy)}
          </span>
        )}
        {/* What the business says about itself, in its own words. Below the
            address because that is the fact a customer scans for first, and
            above the services because it is context for them. */}
        {business.description !== null && business.description.trim() !== "" && (
          <p style={{ margin: "6px 0 0", fontSize: 14.5, color: "var(--muted)", lineHeight: 1.6 }}>
            {business.description}
          </p>
        )}
      </div>

      <ReviewPrompt businessName={business.name} reviews={reviews} />

      {/* The ways to a person, on the screen where the questions a form cannot
          answer come up — "do you take card", "my child is coming too". Above
          the times rather than below them, because somebody who needs to ask
          something first should not have to scroll past the whole booking flow
          to find out they can.

          The call button is the number: a handset and the digits say both what
          the button does and who it reaches, without a line of text repeating
          it. "Call the business" stays as the accessible name, since a screen
          reader announcing thirteen digits alone says nothing about why they
          are there. The other two are their own marks, kept together so
          they wrap as a pair rather than one of them dangling on a line of its
          own, and tinted with the system's own colours: a brand's icon is
          recognised by its shape, and letting two vendor palettes into the page
          would make this row the loudest thing on it. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <a
          href={`tel:${business.phone}`}
          className="chip tap"
          aria-label={`${copy.callBusiness} ${business.phone}`}
          style={{
            gap: 9,
            border: "1px solid var(--accent-strong)",
            background: "var(--accent)",
            color: "var(--on-accent)",
            fontWeight: 600,
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          <span className="tab" dir="ltr" aria-hidden="true">
            {business.phone}
          </span>
        </a>

        <span style={{ display: "flex", gap: 9 }}>
            {mapsHref !== null && (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                aria-label={copy.openInMaps}
                title={copy.openInMaps}
                style={MARK}
                className="chip tap"
              >
                <MapPinMark />
              </a>
            )}
            {whatsapp !== null && (
              <a
                href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                aria-label={copy.whatsappBusiness}
                title={copy.whatsappBusiness}
                style={{ ...MARK, color: "var(--positive)" }}
                className="chip tap"
              >
                <WhatsAppMark />
              </a>
            )}
            {instagram !== null && (
              <a
                href={`https://instagram.com/${instagram}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`${copy.instagramBusiness} @${instagram}`}
                title={`@${instagram}`}
                style={{ ...MARK, color: "var(--accent-strong)" }}
                className="chip tap"
              >
                <InstagramMark />
              </a>
            )}
            {/* A business is a place people send each other to. The device's own
                share sheet where there is one — that is where WhatsApp, a
                message and the clipboard already live — and a straight copy
                where there is not, which is every desktop browser. */}
            <button
              type="button"
              onClick={() => void share()}
              aria-label={copy.shareBusiness}
              title={copy.shareBusiness}
              style={{
                ...MARK,
                color: shared ? "var(--positive)" : "var(--muted)",
                borderColor: shared ? "var(--positive)" : "var(--line)",
              }}
              className="chip tap"
            >
              {shared ? <SharedMark /> : <ShareMark />}
            </button>
        </span>
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

      <WhenSection
        business={business}
        chooser={chooser}
        hasService={service !== null && resource !== null}
        selectedSlot={slot?.startAt ?? null}
        onSelectSlot={(picked) => {
          setSlot(picked);
          setStage("confirming");
        }}
        // Offered only once a Service is chosen: what a day has free depends on
        // how long the Service takes, so waiting for "a morning" is not a
        // question until there is something to fit in it. Nor where the
        // Business's plan has no waiting list: a customer is never offered
        // what could not come to anything (ADR 0019).
        onWaitFor={
          service === null || profile.waitingList === false
            ? undefined
            : (part) => setWaitingFor(part)
        }
        waitingFor={standingParts}
        waitingList={profile.waitingList !== false}
      />

      {error !== null && stage === "choosing" && <Critical>{error}</Critical>}

      {/* ADR 0018. Waiting needs a signed-in customer, because there has to be
          somebody to message — so an unverified visitor is taken through the
          same verification the booking flow uses, and lands back here. */}
      {service !== null && waitingFor !== undefined && (
        <WaitSheet
          open
          business={profile}
          serviceName={service.name}
          onDate={date}
          wantedPart={waitingFor}
          resourceId={resource?.id ?? null}
          existing={standing}
          saving={busy}
          onClose={() => setWaitingFor(undefined)}
          onConfirm={(wish) =>
            void keepWaiting(async (signedIn) => {
              await api.waitForTime(signedIn, {
                businessId: business.id,
                serviceId: service.id,
                onDate: date,
                ...wish,
              });
            })
          }
          onRemove={() =>
            void keepWaiting(async (signedIn) => {
              if (standing === null) return;
              await api.stopWaiting(signedIn, standing.id);
            })
          }
        />
      )}

      {/* No banner. Joining, changing and leaving all show in the button that
          was just pressed — which is where the person is looking, and which is
          still true a minute later. A second confirmation further down the
          page says the same thing somewhere nobody is. */}

      <ReviewSummary reviews={reviews} />

      {/* The page above this line is the demonstration: photos, services, real
          free time, a booking in one tap. An owner checking a business out —
          which is how most of them arrive — has finished evaluating the product
          by the time they read it. Quiet on purpose: it must never compete with
          the booking it sits under. */}
      <a
        href="/pricing"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingBlockStart: 14,
          borderBlockStart: "1px solid var(--line)",
          color: "var(--muted)",
        }}
      >
        <LogoMark size={24} />
        <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>{copy.poweredBy}</span>
      </a>

      <Sheet
        open={stage === "confirming" || stage === "verifying"}
        onClose={() => {
          waitAfterVerifying.current = null;
          setStage("choosing");
        }}
        labelledBy="confirm-title"
      >
        {stage === "confirming" && slot !== null && service !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 id="confirm-title" style={{ fontSize: 20 }}>{copy.confirmTitle}</h2>
            {/* Everything the booking commits them to, in one place. It said
                where, what and when; how long it takes, what it costs and who
                it is with were on other screens or on none, and a confirmation
                that leaves those out is asking somebody to agree to terms it
                has not shown them. */}
            <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Row label={copy.atBusiness} value={business.name} />
              <Row label={copy.service} value={service.name} />
              {resource !== null && <Row label={copy.who} value={resource.name} />}
              <Row
                label={copy.when}
                // Start and finish rather than a start and a duration to add
                // up: "until when am I here" is the question being asked.
                value={`${timeIn(slot.startAt, business.timeZone, language)}–${timeIn(
                  slot.endAt,
                  business.timeZone,
                  language,
                )} · ${new Intl.DateTimeFormat(
                  language === "he" ? "he-IL" : "en-GB",
                  { timeZone: business.timeZone, weekday: "long", day: "numeric", month: "long" },
                ).format(new Date(slot.startAt))}`}
              />
              <Row
                label={copy.howLong}
                value={`${service.durationMinutes} ${copy.minutes}`}
              />
              <Row
                label={copy.priceLabel}
                value={formatPrice(service.priceMinor, language, copy.free)}
              />
            </Card>
            {question === null ? (
              <>
                {/* Optional, and said to be: most bookings need nothing, and a
                    field that looks required makes people invent something. */}
                <MultilineField
                  id="booking-note"
                  label={copy.noteLabel}
                  hint={copy.noteHint}
                  placeholder={copy.notePlaceholder}
                  maxLength={NOTE_LIMIT}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                {error !== null && <Critical>{error}</Critical>}
                <Button onClick={() => void confirm()} busy={busy}>
                  {copy.confirmBooking}
                </Button>
                <Button intent="quiet" onClick={() => setStage("choosing")}>
                  {copy.backToTimes}
                </Button>
              </>
            ) : (
              <>
                {/* A question, not a rejection: the customer may well mean it —
                    two children, one phone number — so the way through is the
                    plain button and the way out is the quiet one. */}
                {/* The appointment they already hold, named back to them: a
                    person cannot tell whether they meant to book another
                    without recognising the first. The calendar is part of that
                    — it may not be the one they are looking at. */}
                {/* The three facts that decide it — who, what and when — are
                    set apart from the sentence carrying them. A reader is
                    checking "is this the one I already booked", and that is a
                    glance rather than a paragraph. */}
                <Warning>
                  {fillParts(
                    question.kind === "SAME_SERVICE"
                      ? question.resourceName === ""
                        ? copy.alreadyBookedAlone
                        : copy.alreadyBooked
                      : question.resourceName === ""
                        ? copy.overlapsAnotherAlone
                        : copy.overlapsAnother,
                    {
                      service: question.serviceName,
                      provider: question.resourceName,
                      business: question.businessName,
                      when: whenOf(question),
                    },
                  ).map((part, at) =>
                    part.filled ? (
                      <b key={at} style={{ fontWeight: 600 }}>
                        {part.text}
                      </b>
                    ) : (
                      <span key={at}>{part.text}</span>
                    ),
                  )}
                </Warning>
                <Button onClick={() => void answer()} busy={busy}>
                  {question.kind === "SAME_SERVICE" ? copy.bookAnyway : copy.bookOverAnyway}
                </Button>
                <Button intent="quiet" onClick={() => { setQuestion(null); setStage("choosing"); }}>
                  {copy.backToTimes}
                </Button>
              </>
            )}
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
              lastName: copy.lastName,
              saveName: copy.saveName,
            }}
            errorText={errorText}
            onVerified={(newToken, newUser) => {
              signIn(newToken, newUser);
              // Verified to wait, not to book: finish the ask they made.
              const waitFor = waitAfterVerifying.current;
              if (waitFor !== null) {
                waitAfterVerifying.current = null;
                setStage("choosing");
                void keepWaiting(waitFor, newToken);
                return;
              }
              // The slot was never held (ADR 0003), so availability is asked
              // again before the booking is attempted.
              setStage("confirming");
              void chooser.refreshDay();
            }}
          />
        )}
      </Sheet>
    </div>
  );
};

const ShareMark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 15.5V4m0 0L8.2 7.8M12 4l3.8 3.8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.5 12.5v5.2A2.3 2.3 0 0 0 7.8 20h8.4a2.3 2.3 0 0 0 2.3-2.3v-5.2"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const SharedMark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m5 12.5 4.5 4.5L19 7.5"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * One square for a brand's mark: the page's own raised surface and line, so the
 * two sit beside the call button as siblings rather than as advertisements.
 */
const MARK = Object.freeze({
  width: 44,
  padding: 0,
  border: "1px solid var(--line)",
  background: "var(--raised)",
});

/** A plain map pin, styled like the phone icon rather than a brand mark. */
const MapPinMark = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 21s-7-6.19-7-11.2C5 5.94 8.13 3 12 3s7 2.94 7 6.8C19 14.81 12 21 12 21Z"
      stroke="var(--muted)"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="9.8" r="2.3" stroke="var(--muted)" strokeWidth="1.7" />
  </svg>
);

/**
 * Instagram's own mark, for the same reason as WhatsApp's.
 */
const InstagramMark = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm7.846-10.405a1.441 1.441 0 01-2.88 0 1.44 1.44 0 012.88 0z" />
  </svg>
);

/**
 * WhatsApp's own mark. A generic speech bubble was standing in for it, which
 * reads as "message us" rather than as the app the customer already has — the
 * whole point of showing a brand's icon is that it is recognised without being
 * read.
 */
const WhatsAppMark = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);

const Row = ({ label, value, action }: { label: string; value: string; action?: ReactNode }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
    <span className="label" style={{ minWidth: 64 }}>{label}</span>
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <span style={{ fontSize: 15, fontWeight: 500, whiteSpace: "pre-wrap" }}>{value}</span>
      {action}
    </span>
  </div>
);

export const CalendarPlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4M12 13.5v5M9.5 16h5" />
  </svg>
);

const PinIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);
