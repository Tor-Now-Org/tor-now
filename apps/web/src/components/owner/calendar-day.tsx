"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  BusinessDayDto,
  CalendarAppointmentDto,
  ResourceDto,
} from "@/lib/api/types.ts";
import { monthName, todayIn, whenIn } from "@/lib/format.ts";
import { countOf } from "@/lib/i18n/counts.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { canCloseBusiness } from "@/lib/roles.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AppointmentSheet } from "./appointment-sheet.tsx";
import { CalendarScope } from "./calendar-scope.tsx";
import { ClosedDay } from "./closed-day.tsx";
import { Month } from "./month.tsx";
import { ActiveFilters, FilterControls, FindControls } from "./day-filter-bar.tsx";
import { BookCustomerSheet } from "./book-customer.tsx";
import type { ChosenCustomer } from "./customer-picker.tsx";
import { NOTHING, anyFilter, keptBy, withinReach, type Facets, type Reach } from "./day-filter.ts";
import {
  answerTo,
  hasFailed,
  isPending,
  useAppointmentSearch,
} from "./day-search.ts";
import { DayTimeline, type Picked } from "./day-timeline.tsx";
import { DayActionSheet } from "./day-actions.tsx";
import { AddButton, FinishAim, type Aim } from "./day-add.tsx";
import { Card, Critical, Empty, Note, Spinner } from "../ui.tsx";
import { shiftMonth } from "./month-model.ts";

/**
 * The owner's day. ADR 0003 declines to keep this live: it is fetched on open
 * and on refresh, and the hint below says so rather than letting an owner
 * believe a stale screen is current.
 */
/** Long enough that a name is one request, short enough to feel immediate. */

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
  /** The same day across every calendar, which is what the timeline draws. */
  const [wholeDay, setWholeDay] = useState<BusinessDayDto | null>(null);
  /** What a tap on the timeline opened: an item, or a stretch of free time. */
  const [picked, setPicked] = useState<Picked | null>(null);
  /** Reading every calendar at once, which only means anything past one. */
  const [showEveryone, setShowEveryone] = useState(false);
  /** Two ways in, one state: a person named, and kinds chosen. */
  const [facets, setFacets] = useState<Facets>(NOTHING);
  const [filterSheet, setFilterSheet] = useState(false);
  /** Whether the search has been asked for. It is a button until it is. */
  const [searching, setSearching] = useState(false);
  /** Which month the grid is showing. The toolbar that says so lives here. */
  const [firstOfMonth, setFirstOfMonth] = useState(
    () => `${todayIn(business.timeZone).slice(0, 7)}-01`,
  );
  const [reach, setReach] = useState<Reach>("DAY");
  /**
   * Bumped when anything on this screen changed what the answers would be.
   *
   * Every question the screen has open reads it: the month, the search, and
   * the named customer's own list. Only the day used to be re-asked after a
   * cancellation or a move, so the other two went on showing what had been
   * true before the button was pressed — most visibly the search, which kept
   * an appointment on screen that the same screen had just cancelled.
   */
  const [freshness, setFreshness] = useState(0);
  /** Bumped when the day changes something the month draws, so it reloads. */
  const [monthKey, setMonthKey] = useState(0);
  /**
   * The booking being written, and what the way in already answered.
   *
   * Null means no booking is in progress. The day is always known by the time
   * this is set — every way in supplies one — while the calendar, the stretch
   * and the customer are each filled by some ways in and not others.
   */
  const [booking, setBooking] = useState<{
    date: string;
    resourceId: string | null;
    suggest: { start: number; end: number } | null;
    customer: ChosenCustomer | null;
  } | null>(null);
  /** What the + started, and the days it is waiting to be aimed at. */
  const [aim, setAim] = useState<Aim | null>(null);
  /**
   * Somebody carried into the aim.
   *
   * Booking that starts from a customer's record already knows who, and only
   * needs a day — so it enters the same aim the + does, with her along for the
   * ride. That is what keeps "when can she come in?" from needing a flow of
   * its own.
   */
  const [aimedCustomer, setAimedCustomer] = useState<ChosenCustomer | null>(null);
  const [aimedAt, setAimedAt] = useState<readonly string[]>([]);
  /**
   * Everything the named customer has, fetched by their number rather than read
   * off the search box — editing or clearing the query used to empty the very
   * list the chip was pointing at.
   */
  const [theirs, setTheirs] = useState<CalendarAppointmentDto[] | null>(null);
  const [selected, setSelected] = useState<CalendarAppointmentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * What is being looked for, and what came back.
   *
   * While this box has something in it, the search replaces the calendar rather
   * than sitting beside it: the owner is looking for one appointment, not at a
   * day. The answer lives in day-search.ts, which keeps it tied to the query it
   * answers — see the note there for why a bare list could not be trusted.
   */
  const [query, setQuery] = useState("");
  const search = useAppointmentSearch(token, business.id, query, freshness);
  const found = answerTo(search, query);
  /**
   * The business's services, in their own order.
   *
   * Only for colour: a service takes its hue from where it sits in this list,
   * so the same haircut is the same colour on every day of the month. Read
   * once per business rather than per day, because the list does not change
   * between one Tuesday and the next.
   */
  const [offered, setOffered] = useState<readonly string[]>([]);

  useEffect(() => {
    let current = true;
    api
      .listServices(token, business.id)
      .then((services) => {
        if (current) setOffered(services.map((one) => one.name));
      })
      .catch(() => {
        // Colour falls back to a hash of the name, which is stable enough to
        // read a day by; it is not worth an error on a calendar.
        if (current) setOffered([]);
      });
    return () => {
      current = false;
    };
  }, [token, business.id]);

  const load = useCallback(async () => {
    if (resource === null) return;
    setBusy(true);
    try {
      // One read, for every calendar. Loading the chosen calendar's day as
      // well was both a second request per tap and a second answer that could
      // disagree with the first — which is what made an appointment in another
      // lane unopenable: it was looked up in a day that did not contain it.
      setWholeDay(await api.businessDay(token, business.id, date));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  }, [token, business.id, resource, date, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const customer = facets.customer;
    if (customer === null) {
      setTheirs(null);
      return;
    }
    let current = true;
    api
      .searchAppointments(token, business.id, customer.phone)
      .then((matches) => {
        if (current) setTheirs(matches);
      })
      .catch(() => {
        if (current) setTheirs([]);
      });
    return () => {
      current = false;
    };
  }, [facets.customer, token, business.id, freshness]);

  /**
   * Whether the shop is shut that day, and whether anybody decided it.
   *
   * Shut means every calendar being shut: one chair off for the afternoon is
   * that chair's day, and the screen still has a day to draw.
   *
   * `decided` separates a closure from a rest day. A closure is an override on
   * this date (ADR 0002) — it carries words, and it can be described or undone.
   * A rest day is the week's own shape, with no override behind it and so
   * nothing on this date to describe or undo. Both look identical from `open`
   * alone, which is why the day used to offer a closure's controls on a
   * Saturday, where they matched no closure and silently did nothing.
   */
  const shut =
    wholeDay !== null &&
    wholeDay.calendars.length > 0 &&
    wholeDay.calendars.every((calendar) => calendar.open.length === 0)
      ? {
          decided: wholeDay.calendars.some((calendar) => calendar.special),
          note: wholeDay.calendars.find((calendar) => calendar.special)?.note ?? null,
        }
      : null;

  /**
   * Ask everything on screen again.
   *
   * One function rather than each caller remembering the list: the day, the
   * month, the search and the named customer's appointments are four answers
   * to the same underlying facts, and anything that changes those facts
   * invalidates all four. Refreshing a subset is how the search came to
   * contradict the day.
   */
  const refreshEverything = useCallback(async () => {
    setFreshness((key) => key + 1);
    setMonthKey((key) => key + 1);
    await load();
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refreshEverything();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  /** While somebody is typing, the row is the field and the month steps aside. */
  const looking = searching || query !== "";

  /**
   * Back to the day itself.
   *
   * Taking the chips off is not enough: the words in the search box are a
   * filter of their own — they answer with the matches rather than with the
   * day — so "clear" has to mean both, or the day never comes back.
   */
  const showTheWholeDay = () => {
    setFacets(NOTHING);
    setQuery("");
    setReach("DAY");
  };

  return (
    <div style={{ padding: "10px 18px 28px", display: "flex", flexDirection: "column", gap: 11 }}>
      {/* One row for the whole screen: which month it is showing, and the two
          controls for finding things in it. They had a row of their own above
          the calendar, which cost the month most of a week of squares — and
          this row had its width going spare. It stays put when the screen
          swaps the calendar for a list of results, which is why the month it
          is showing is decided here rather than inside the grid. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34 }}>
        {!looking && (
          <>
            <button
              className="chip tap"
              aria-label={copy.previousMonth}
              onClick={() => setFirstOfMonth(shiftMonth(firstOfMonth, -1))}
              style={{ minWidth: 34, minHeight: 34 }}
            >
              ‹
            </button>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "center",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {/* Short where the row is shared with the calendar picker: that
                  chip and this name are the two things here that can grow, and
                  only one of them is a name somebody chose. */}
              {monthName(
                firstOfMonth,
                business.timeZone,
                language,
                resources.length > 1 ? "short" : "long",
              )}
            </span>
            <button
              className="chip tap"
              aria-label={copy.nextMonth}
              onClick={() => setFirstOfMonth(shiftMonth(firstOfMonth, 1))}
              style={{ minWidth: 34, minHeight: 34 }}
            >
              ›
            </button>
          </>
        )}
        {!looking && (
          <CalendarScope
            resources={resources}
            everyone={showEveryone}
            chosen={resource}
            onEveryone={() => setShowEveryone(true)}
            onChoose={(one) => {
              setResource(one);
              setShowEveryone(false);
            }}
          />
        )}
        <FindControls
          query={query}
          onQuery={setQuery}
          open={searching}
          onOpen={setSearching}
          facets={facets}
          onSheet={setFilterSheet}
        />
      </div>

      <FilterControls
        query={query}
        facets={facets}
        onFacets={(next) => {
          setFacets(next);
          // Naming a person is not reading a day: "when is she next in" is the
          // question, and it is rarely about today. So a customer opens at
          // everything and narrows by tap — the other way round hid an
          // appointment six weeks out behind an empty result.
          setReach(next.customer === null ? "DAY" : "ALL");
        }}
        suggestions={found ?? wholeDay?.calendars.flatMap((one) => one.appointments) ?? []}
        onSheet={setFilterSheet}
        sheetOpen={filterSheet}
        resources={resources}
        services={[
          ...new Set(
            (wholeDay?.calendars ?? []).flatMap((one) =>
              one.appointments.map((appointment) => appointment.serviceName),
            ),
          ),
        ]}
      />

      {anyFilter(facets) ? (
        // Filtered is a different question from "what does this day look
        // like", so it gets a different answer: their things, in time order,
        // and the whole day one ✕ away.
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(() => {
            const pool =
              facets.customer === null
                ? (wholeDay?.calendars ?? []).flatMap((one) => one.appointments)
                : (theirs ?? []);
            const kept = withinReach(
              keptBy(pool, facets, Date.now()),
              facets.customer === null ? "DAY" : reach,
              date,
              business.timeZone,
            ).sort((left, right) => left.startAt.localeCompare(right.startAt));
            return (
              <>
                <ActiveFilters
                  facets={facets}
                  onFacets={setFacets}
                  resources={resources}
                  reach={reach}
                  onReach={setReach}
                  count={kept.length}
                  onClear={showTheWholeDay}
                />
                {facets.customer !== null && theirs === null ? (
                  <Spinner />
                ) : kept.length === 0 ? (
                  <Empty title={copy.noMatches} body={copy.findAppointmentHint} />
                ) : (
                  kept.map((appointment) => (
                    <button
                      key={appointment.id}
                      onClick={() => setSelected(appointment)}
                      style={{ textAlign: "start" }}
                    >
                      <Card
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12 }}
                      >
                        <span className="tab hint" style={{ width: 74 }}>
                          {whenIn(appointment.startAt, business.timeZone, language)}
                        </span>
                        <span
                          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}
                        >
                          <span style={{ fontWeight: 500 }}>{appointment.customerName}</span>
                          <span className="hint">
                            {appointment.serviceName} · {appointment.resourceName}
                          </span>
                        </span>
                      </Card>
                    </button>
                  ))
                )}
              </>
            );
          })()}
        </div>
      ) : isPending(search, query) ? (
        // A question being asked is not an answer, and it is certainly not the
        // previous question's answer, which is what used to sit here.
        <Spinner />
      ) : hasFailed(search, query) ? (
        <Critical>{copy.findFailed}</Critical>
      ) : found !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {found.length === 0 ? (
            <Empty title={copy.noMatches} body={copy.findAppointmentHint} />
          ) : (
            <>
              <span className="label">
                {countOf(language, found.length, copy.appointmentsCount)}
              </span>
              {found.map((appointment) => (
                <button
                  key={appointment.id}
                  onClick={() => setSelected(appointment)}
                  style={{ textAlign: "start" }}
                >
                  <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}
                    >
                      <span style={{ fontWeight: 500 }}>{appointment.customerName}</span>
                      <span className="hint">{appointment.serviceName}</span>
                    </span>
                    {/* The date is the answer here, so it leads rather than
                        being assumed from which day is open. */}
                    <span
                      className="tab"
                      style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 14 }}
                    >
                      {whenIn(appointment.startAt, business.timeZone, language)}
                    </span>
                  </Card>
                </button>
              ))}
              <Note>{copy.findAppointmentHint}</Note>
            </>
          )}
        </div>
      ) : (
      <>
      <Month
        token={token}
        business={business}
        resources={resources}
        scope={showEveryone ? null : (resource?.id ?? null)}
        selected={date}
        onPickDay={setDate}
        reloadKey={monthKey}
        choosing={
          aim === null
            ? null
            : aim === "appointment"
              ? {
                  title:
                    aimedCustomer === null
                      ? copy.aimAppointment
                      : copy.aimAppointmentFor.replace("{name}", aimedCustomer.name),
                  // One day, because that is what an appointment happens on.
                  single: true,
                }
              : { title: aim === "block" ? copy.aimBlock : copy.aimSpecial }
        }
        onChosen={(dates) => {
          // An appointment has nothing further to decide about the days, so
          // aiming it goes straight to the sheet rather than through the step
          // that asks a blockage for its hours.
          if (aim === "appointment") {
            const chosen = dates[0];
            if (chosen === undefined) return;
            setAim(null);
            setAimedAt([]);
            setBooking({
              date: chosen,
              // Nothing was tapped, so neither the calendar nor an hour is
              // implied — the sheet asks for both.
              resourceId: showEveryone ? null : (resource?.id ?? null),
              suggest: null,
              customer: aimedCustomer,
            });
            setAimedCustomer(null);
            return;
          }
          setAimedAt(dates);
        }}
        onCancelChoosing={() => {
          setAim(null);
          setAimedAt([]);
          setAimedCustomer(null);
        }}
        onChanged={() => void load()}
        firstOfMonth={firstOfMonth}
      />

      {error !== null && <Critical>{error}</Critical>}

      {busy && wholeDay === null ? (
        <Spinner />
      ) : wholeDay === null ? (
        <Empty title={copy.noAppointments} body={copy.refreshHint} />
      ) : shut !== null ? (
        // A day the shop is closed on is not a quiet day. It drew as an empty
        // timeline full of bookable-looking free time, which is the opposite of
        // what it is — so it says so, in the words it was closed with.
        <ClosedDay
          decided={shut.decided}
          note={shut.note}
          date={date}
          copy={copy}
          language={language}
          mayReopen={canCloseBusiness(business)}
          busy={busy}
          onReopen={() =>
            void act(() => api.reopenBusiness(token, business.id, date, date))
          }
          onDescribe={(said) =>
            void act(() =>
              api.describeClosure(token, business.id, {
                fromDate: date,
                toDate: date,
                note: said.trim() === "" ? null : said.trim(),
              }),
            )
          }
        />
      ) : (
        // The day as it will be lived: everything in one column against the
        // hours, with the free stretches tappable — they are the part an owner
        // wants to fill, and they used to be the part that was not there.
        <DayTimeline
          day={wholeDay}
          timeZone={business.timeZone}
          offered={offered}
          lanes={
            resource === null
              ? []
              : resources.length > 1 && showEveryone
                ? resources.map((one) => ({ id: one.id, name: one.name }))
                : [{ id: resource.id, name: resource.name }]
          }
          onPick={(entry) => {
            if (entry.kind === "appointment") {
              const found =
                (wholeDay?.calendars ?? [])
                  .flatMap((one) => one.appointments)
                  .find((one) => one.id === entry.id) ?? null;
              setSelected(found);
              return;
            }
            setPicked(entry);
          }}
        />
      )}

      <DayActionSheet
        picked={picked}
        token={token}
        business={business}
        date={date}
        past={date < todayIn(business.timeZone)}
        onClose={() => setPicked(null)}
        onChanged={() => {
          setPicked(null);
          void refreshEverything();
        }}
        onBook={(span, resourceId) => {
          // The stretch sheet steps aside for the booking sheet rather than
          // stacking on top of it.
          setPicked(null);
          setBooking({ date, resourceId, suggest: span, customer: null });
        }}
      />
      </>
      )}

      <AddButton
        // Sheets take care of themselves now; what is left is the one state
        // that is not a sheet — the grid waiting for days to be chosen.
        hidden={aim !== null}
        canCloseBusiness={canCloseBusiness(business)}
        onAim={(chosen) => {
          setAim(chosen);
          setAimedAt([]);
        }}
      />

      <FinishAim
        aim={aim}
        dates={aimedAt}
        token={token}
        business={business}
        resource={resource}
        onClose={() => setAimedAt([])}
        onCancel={() => {
          setAim(null);
          setAimedAt([]);
        }}
        onDone={() => {
          setAim(null);
          setAimedAt([]);
          void refreshEverything();
        }}
      />

      <BookCustomerSheet
        open={booking !== null}
        token={token}
        business={business}
        resources={resources}
        date={booking?.date ?? date}
        resourceId={booking?.resourceId ?? null}
        suggest={booking?.suggest ?? null}
        customer={booking?.customer ?? null}
        onClose={() => setBooking(null)}
        onBooked={() => {
          setBooking(null);
          void refreshEverything();
        }}
      />

      <AppointmentSheet
        token={token}
        business={business}
        appointment={selected}
        onClose={() => setSelected(null)}
        onChanged={refreshEverything}
        onBookAnother={(customer) => {
          // Into the same aim the + uses, with her along for the ride: the
          // only thing still missing is a day.
          //
          // The search has to be handed back first. While it has words in it
          // the screen is answering "where is she", and the month — which is
          // what a day is chosen on — is not on screen at all. Choosing a day
          // is a different question, so it gets the calendar back.
          setSelected(null);
          showTheWholeDay();
          setAimedCustomer(customer);
          setAim("appointment");
          setAimedAt([]);
        }}
      />
    </div>
  );
};
