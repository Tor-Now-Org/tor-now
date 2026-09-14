"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, CustomerDto, ResourceDto, ServiceDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Chip, Critical, Note, Sheet, Spinner, Warning } from "../ui.tsx";
import { CustomerPicker, type ChosenCustomer } from "./customer-picker.tsx";
import { Mark } from "./lane-mark.tsx";
import { minutesOf, type Span } from "./day-model.ts";

/**
 * The Business booking somebody in.
 *
 * One sheet, reached four ways, and the ways in differ only by what they have
 * already answered — a tap on a free stretch knows the day and the calendar, a
 * customer's record knows the customer, the + knows neither. Everything after
 * that is the same three questions in the same order: who, what, and which
 * hour.
 *
 * The hours are availability for the chosen service, not the stretch that was
 * tapped. Asking for a stretch and then a time inside it was the same question
 * twice: availability already accounts for the gaps, the blockages, the working
 * hours and the notice period, so the free time *is* the list of hours. What
 * the tapped stretch does instead is suggest — its first hour is selected and
 * the hours inside it are marked — while the rest of the day stays offered,
 * because "actually, make it half three" is a normal thing to hear halfway
 * through writing somebody in.
 */
export const BookCustomerSheet = ({
  open,
  token,
  business,
  resources,
  date,
  resourceId,
  suggest,
  customer,
  onClose,
  onBooked,
}: {
  open: boolean;
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** Every way in supplies a day; there is no path here without one. */
  date: string;
  /** The calendar, when a lane was tapped. Null asks for it. */
  resourceId: string | null;
  /** The stretch that was tapped, as minutes from midnight. A hint, not a bound. */
  suggest: Span | null;
  /** Pre-filled when the booking started from somebody's record. */
  customer: ChosenCustomer | null;
  onClose: () => void;
  onBooked: (customerName: string) => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [services, setServices] = useState<readonly ServiceDto[] | null>(null);
  const [customers, setCustomers] = useState<readonly CustomerDto[] | null>(null);
  const [chosenCustomer, setChosenCustomer] = useState<ChosenCustomer | null>(customer);
  const [chosenService, setChosenService] = useState<ServiceDto | null>(null);
  const [chosenResource, setChosenResource] = useState<string | null>(resourceId);
  const [slots, setSlots] = useState<readonly string[] | null>(null);
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What booking stopped to ask, and the answer it is waiting for. */
  const [question, setQuestion] = useState<
    { kind: "SAME_SERVICE" | "OVERLAP"; said: string } | null
  >(null);

  // Re-arm every time the sheet is opened: a sheet that remembers the last
  // customer is a sheet that books the wrong person.
  useEffect(() => {
    if (!open) return;
    setChosenCustomer(customer);
    setChosenResource(resourceId);
    setChosenService(null);
    setChosenSlot(null);
    setSlots(null);
    setError(null);
    setQuestion(null);
  }, [open, customer, resourceId]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void Promise.all([
      api.listServices(token, business.id),
      api.listCustomers(token, business.id),
    ])
      .then(([theirs, people]) => {
        if (!current) return;
        setServices(theirs);
        setCustomers(people);
        // One service is not a choice, so it is not presented as one.
        if (theirs.length === 1) setChosenService(theirs[0] ?? null);
      })
      .catch(() => {
        if (current) setError(errorText("INTERNAL"));
      });
    return () => {
      current = false;
    };
  }, [open, token, business.id, errorText]);

  const wantedResource = chosenResource ?? resources[0]?.id ?? null;
  const laneIndex = Math.max(
    0,
    resources.findIndex((one) => one.id === wantedResource),
  );
  const namedResource = resources[laneIndex]?.name ?? "";
  /** Whether the calendar is still a question, as against a fact to be told. */
  const choosable = resources.length > 1 && resourceId === null;

  /**
   * The hours, for this service on this calendar on this day.
   *
   * Asked again whenever any of those three changes, because all three decide
   * the answer — a longer service has fewer starts, and another calendar has
   * different ones.
   */
  useEffect(() => {
    if (!open || chosenService === null || wantedResource === null) {
      setSlots(null);
      return;
    }
    let current = true;
    setSlots(null);
    api
      .availability(business.id, {
        serviceId: chosenService.id,
        resourceId: wantedResource,
        from: date,
        to: date,
      })
      .then(([day]) => {
        if (!current) return;
        const found = (day?.slots ?? []).map((slot) => slot.startAt);
        setSlots(found);
        // The tapped stretch suggests; it does not confine. Its first hour is
        // chosen so the common case is one tap from done.
        setChosenSlot(
          suggest === null
            ? null
            : (found.find((startAt) => withinSuggestion(startAt, suggest, business.timeZone)) ??
              null),
        );
      })
      .catch(() => {
        if (current) {
          setSlots([]);
          setError(errorText("INTERNAL"));
        }
      });
    return () => {
      current = false;
    };
  }, [open, chosenService, wantedResource, date, business.id, business.timeZone, suggest, errorText]);

  const addCustomer = useCallback(
    async (input: { phone: string; givenName: string }) => {
      setBusy(true);
      setError(null);
      try {
        const made = await api.addCustomer(token, business.id, {
          phone: input.phone,
          givenName: input.givenName,
          familyName: null,
        });
        setCustomers((known) => [...(known ?? []), made]);
        setChosenCustomer({ id: made.id, name: made.name, phone: made.phone });
      } catch (cause) {
        setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      } finally {
        setBusy(false);
      }
    },
    [token, business.id, errorText],
  );

  const bookIt = async (answered: boolean) => {
    if (chosenCustomer === null || chosenService === null || chosenSlot === null) return;
    if (wantedResource === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.book(token, {
        businessId: business.id,
        serviceId: chosenService.id,
        resourceId: wantedResource,
        startAt: chosenSlot,
        customerNote: null,
        forCustomerId: chosenCustomer.id,
        ...(answered && question?.kind === "SAME_SERVICE"
          ? { bookingAnotherOfTheSame: true }
          : {}),
        ...(answered && question?.kind === "OVERLAP" ? { bookingOverAnother: true } : {}),
      });
      onBooked(chosenCustomer.name);
    } catch (cause) {
      const asking =
        isApiError(cause) && cause.code === "ALREADY_BOOKED_THAT_DAY"
          ? "SAME_SERVICE"
          : isApiError(cause) && cause.code === "OVERLAPS_ANOTHER_APPOINTMENT"
            ? "OVERLAP"
            : null;
      if (asking !== null && isApiError(cause)) {
        // A question, not a refusal — and one the person at the desk is better
        // placed to answer than the customer was, since they can see the day.
        setQuestion({ kind: asking, said: errorText(cause.code) });
        return;
      }
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    chosenCustomer !== null && chosenService !== null && chosenSlot !== null && !busy;

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 style={{ fontSize: 18 }}>{copy.addAppointmentTitle}</h2>
          {/* Which day, said out loud. Three of the four ways in choose the day
              somewhere else — a square, an aim, a stretch — and by the time the
              sheet is open that choice is off screen. */}
          <span
            className="hint"
            style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
          >
            {formatLocalDate(date, language, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            {/* Whose diary, said here when it is not a question. It still has
                to be said — with two chairs it is the thing most worth being
                sure of — but a labelled box of its own was a row of the sheet
                spent on a fact with no decision in it. */}
            {!choosable && namedResource !== "" && (
              <>
                <span aria-hidden="true">·</span>
                <Mark name={namedResource} index={laneIndex} size={14} />
                <span>{namedResource}</span>
              </>
            )}
          </span>
        </div>

        {error !== null && <Critical>{error}</Critical>}

        <CustomerPicker
          customers={customers ?? []}
          loading={customers === null}
          chosen={chosenCustomer}
          onChoose={setChosenCustomer}
          onCreate={addCustomer}
          busy={busy}
        />

        {choosable && (
          <>
            <span className="label">{copy.whichCalendar}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {resources.map((one) => (
                <Chip
                  key={one.id}
                  selected={wantedResource === one.id}
                  onClick={() => setChosenResource(one.id)}
                >
                  {one.name}
                </Chip>
              ))}
            </div>
          </>
        )}

        {services !== null && services.length > 1 && (
          <>
            <span className="label">{copy.servicesWord}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {services.map((one) => (
                <Chip
                  key={one.id}
                  selected={chosenService?.id === one.id}
                  onClick={() => setChosenService(one)}
                >
                  {one.name} · {one.durationMinutes}
                  {copy.minutesShort}
                </Chip>
              ))}
            </div>
          </>
        )}

        {chosenService !== null && (
          <>
            <span className="label">{copy.availableHours}</span>
            {slots === null ? (
              <Spinner />
            ) : slots.length === 0 ? (
              <Note>
                {copy.noHoursForService.replace("{service}", chosenService.name)}{" "}
                {copy.tryAnotherDayOrService}
              </Note>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                    gap: 6,
                  }}
                >
                  {slots.map((startAt) => (
                    <Chip
                      key={startAt}
                      className="tab"
                      selected={chosenSlot === startAt}
                      onClick={() => setChosenSlot(startAt)}
                      style={
                        // Inside the stretch that was tapped: marked, so the
                        // suggestion is visible, but no harder to leave than
                        // any other hour.
                        suggest !== null &&
                        chosenSlot !== startAt &&
                        withinSuggestion(startAt, suggest, business.timeZone)
                          ? {
                              background: "var(--accent-soft)",
                              borderColor: "var(--accent)",
                            }
                          : undefined
                      }
                    >
                      {hourIn(startAt, business.timeZone, language)}
                    </Chip>
                  ))}
                </div>
                {suggest !== null && <span className="hint">{copy.fromTheStretch}</span>}
              </>
            )}
          </>
        )}

        {question !== null && (
          <>
            <Warning>{question.said}</Warning>
            <Button busy={busy} onClick={() => void bookIt(true)}>
              {copy.bookAnyway}
            </Button>
          </>
        )}

        {question === null && (
          <Button busy={busy} disabled={!ready} onClick={() => void bookIt(false)}>
            {chosenSlot === null
              ? copy.addAppointmentTitle
              : copy.bookAt.replace(
                  "{time}",
                  hourIn(chosenSlot, business.timeZone, language),
                )}
          </Button>
        )}
      </div>
    </Sheet>
  );
};

/** The clock time an instant reads as, in the business's own zone. */
const hourIn = (instant: string, timeZone: string, language: string): string =>
  new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));

/** Whether an hour falls inside the stretch that was tapped. */
const withinSuggestion = (instant: string, suggest: Span, timeZone: string): boolean => {
  const minutes = minutesOf(hourIn(instant, timeZone, "en"));
  return minutes >= suggest.start && minutes < suggest.end;
};

