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
import { formatLocalDate, formatPrice, timeIn, todayIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { useSession } from "@/lib/session.tsx";
import { DateStrip } from "../date-strip.tsx";
import { SlotGrid } from "../slot-grid.tsx";
import { VerifyPanel } from "../verify-panel.tsx";
import { BusinessPhotos } from "./business-photos.tsx";
import { Button, Card, Critical, MultilineField, Sheet, Spinner, Warning } from "../ui.tsx";

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

  const [profile, setProfile] = useState<BusinessProfileDto | null>(null);
  const [service, setService] = useState<ServiceDto | null>(null);
  const [resource, setResource] = useState<ResourceDto | null>(null);
  const [date, setDate] = useState(() => todayIn(business.timeZone));
  const [day, setDay] = useState<DayAvailabilityDto | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [stage, setStage] = useState<Stage>("choosing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** Briefly true after the address is copied, where there is no share sheet. */
  const [shared, setShared] = useState(false);
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
    // A booking error belongs to the choice that produced it; changing the
    // service, calendar or day makes it stale.
    setError(null);
    // The profile may already have answered this exact question. Skip it once,
    // then forget — every later change of service, calendar or day is a real
    // request, because availability is never assumed to have stayed still.
    if (alreadyHave.current === key(service?.id, resource?.id, date)) {
      alreadyHave.current = null;
      return;
    }
    void loadDay();
  }, [loadDay, service, resource, date]);

  /**
   * `answers` carries what the customer has already said yes to. Both are false
   * on a first attempt, so it stops and asks; each answer given is kept for
   * every attempt after it, since a second question does not withdraw the first
   * answer.
   */
  const confirm = async (answers = answered) => {
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
        customerNote: note.trim() === "" ? null : note.trim(),
        ...(answers.sameService ? { bookingAnotherOfTheSame: true } : {}),
        ...(answers.overlap ? { bookingOverAnother: true } : {}),
      });
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
        await loadDay();
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

  if (profile === null) return <Spinner />;

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
      <BusinessPhotos
        photos={profile.photos}
        businessName={business.name}
        labels={{ gallery: copy.photosOf, showPhoto: copy.showPhoto }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 22 }}>{business.name}</h1>
        {business.address !== null && <span className="hint">{business.address}</span>}
        {/* What the business says about itself, in its own words. Below the
            address because that is the fact a customer scans for first, and
            above the services because it is context for them. */}
        {business.description !== null && business.description.trim() !== "" && (
          <p style={{ margin: "6px 0 0", fontSize: 14.5, color: "var(--muted)", lineHeight: 1.6 }}>
            {business.description}
          </p>
        )}
      </div>

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
                <Warning>
                  {(question.kind === "SAME_SERVICE"
                    ? copy.alreadyBooked
                    : copy.overlapsAnother
                  )
                    .replace("{service}", question.serviceName)
                    .replace("{business}", question.businessName)
                    .replace("{when}", whenOf(question))
                    .replace(
                      "{with}",
                      question.resourceName === ""
                        ? ""
                        : ` ${copy.withProvider} ${question.resourceName}`,
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

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
    <span className="label" style={{ minWidth: 64 }}>{label}</span>
    <span style={{ fontSize: 15, fontWeight: 500 }}>{value}</span>
  </div>
);
