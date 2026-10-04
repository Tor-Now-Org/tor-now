"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  BusinessMonthDto,
  ChangeDto,
  ResourceDto,
} from "@/lib/api/types.ts";
import { formatLocalDate, monthName, todayIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { laneColourOf } from "./event-colour.ts";
import { Button, Card, Critical, Sheet, Spinner } from "../ui.tsx";
import { BAND_AREA, ChangeBands, changesFor, WeekChanges } from "./change-bands.tsx";
import {
  datesBetween,
  factsOn,
  mergeMonths,
  monthsOf,
  nothingKnown,
  worksOn,
  weekFrom,
  weeksOf,
} from "./month-model.ts";

/**
 * The month, as the business reads one.
 *
 * It answers two questions at once — what does the month look like, and what do
 * I want to change about it — because those are the same question for an owner
 * looking at a holiday they have not booked yet. A tap opens a day; a second
 * tap on another day takes the range between them, which is how a week away is
 * said in one gesture instead of seven forms.
 *
 * Every calendar at once by default: the shop's closures belong to all of them,
 * and "who is free on Thursday" cannot be answered one calendar at a time. A
 * business with a single calendar sees none of the chrome — no scope chips, no
 * marks — because for them there is nothing to tell apart.
 */

/**
 * The shade of a square: what the shop is doing, before who is busy.
 *
 * "shut" and "resting" are both closed and are not the same thing. A Saturday
 * the business never opens on is the shape of its week; a Saturday it decided
 * to close is a decision somebody made, can undo, and may have written a reason
 * on. Drawing them alike left an owner unable to tell which Saturdays they had
 * done something about.
 */
type Weather = "open" | "short" | "shut" | "resting";

const weatherOn = (month: BusinessMonthDto, date: string, scope: string | null): Weather => {
  const facts = factsOn(month, date);
  if (facts.shopClosed) return "shut";
  if (!worksOn(facts, scope)) return "resting";
  return facts.shopHours.length > 0 ? "short" : "open";
};

export const Month = ({
  token,
  business,
  resources,
  scope,
  selected,
  firstOfMonth,
  firstOfWeek = null,
  onPickDay,
  reloadKey,
  choosing,
  onChosen,
  onCancelChoosing,
  onOpenChange,
  onReady,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** Which calendar the screen is reading, or null for all of them. */
  scope: string | null;
  /** The day the timeline below is showing, so the grid can mark it. */
  selected: string;
  /**
   * Which month to draw.
   *
   * Owned by the screen rather than by the grid: the row carrying the month's
   * name also carries the find-and-filter controls, and that row has to stay
   * put when the screen swaps the calendar for a list of search results.
   */
  firstOfMonth: string;
  /**
   * One week instead of the month, from its Sunday.
   *
   * The same grid folded to a single row rather than a view of its own, so
   * everything a month does — reading a day, aiming a blockage or special
   * hours at a run of days, the bars across them — a week does the same way.
   * A week that crosses the first of the month is read from both months.
   */
  firstOfWeek?: string | null;
  onPickDay: (date: string) => void;
  /** Changes when something elsewhere edited the month, so it reloads. */
  reloadKey: number;
  /**
   * What the owner is choosing days for, if anything.
   *
   * Reading a month and changing one are different jobs, and the grid used to
   * offer both at once: every tap put three buttons under the calendar, two of
   * which nobody had asked for. Now a tap is only ever "show me this day", and
   * the actions arrive with an action already chosen from the + — which is also
   * what makes "these days" a sensible question to ask.
   */
  choosing: {
    readonly title: string;
    /**
     * One day rather than a run of them.
     *
     * A blockage or a closure covers days; an appointment happens on one. A
     * second tap moves the choice rather than building a range, so nobody can
     * assemble a selection the next step cannot use.
     */
    readonly single?: boolean;
  } | null;
  onChosen: (dates: readonly string[]) => void;
  onCancelChoosing: () => void;
  /** A change's band was tapped: the screen opens its detail, the same one every door opens. */
  onOpenChange: (change: ChangeDto) => void;
  /**
   * The grid has an answer to draw.
   *
   * The day below waits for it, so a first load shows one spinner where the
   * calendar will be instead of two, one under the other.
   */
  onReady?: () => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  /**
   * The month, and which month it is of.
   *
   * Kept together because they were not. The grid draws the dates of whatever
   * `firstOfMonth` says while the answer for that month is still in flight, so
   * for a moment it was asking last month's answer about next month's dates —
   * every lookup missed, every day fell back to the default, and a whole month
   * drew as though nobody worked in it. Stepping forward and back was enough to
   * see it. A late answer to a question nobody is asking any more is dropped
   * for the same reason.
   */
  const [month, setMonth] = useState<{ of: string; data: BusinessMonthDto; changes: readonly ChangeDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The two taps. The second one turns a day into a range. */
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  /** A week whose decisions did not all fit under it, opened as a list. */
  const [openWeek, setOpenWeek] = useState<number | null>(null);

  // Days chosen belong to the question they answered. Once it is answered or
  // dropped, the next one starts with nothing picked: a first tap left behind
  // turned the next single day into a range ending on it.
  const askingForDays = choosing !== null;
  useEffect(() => {
    if (askingForDays) return;
    setFrom(null);
    setTo(null);
  }, [askingForDays]);

  const onOffer = resources.filter((resource) => resource.active !== false);

  /**
   * The month the screen is on right now, readable from inside an answer that
   * is still in flight — which is the only way to tell a late answer to a
   * question nobody is asking any more from the answer to this one.
   */
  const reading = firstOfWeek ?? firstOfMonth;
  const wanted = useRef(reading);
  wanted.current = reading;

  const load = useCallback(async () => {
    setError(null);
    const asked = firstOfWeek ?? firstOfMonth;
    try {
      // The changes over exactly the days on screen, read once whichever months they fall in.
      const shown = (firstOfWeek === null ? weeksOf(firstOfMonth).flat() : weekFrom(firstOfWeek)).filter(
        (date): date is string => date !== null,
      );
      const [months, changes] = await Promise.all([
        Promise.all(
          (firstOfWeek === null ? [firstOfMonth] : monthsOf(weekFrom(firstOfWeek))).map(
            (month) => api.businessMonth(token, business.id, month),
          ),
        ),
        api.listChanges(token, business.id, { from: shown[0] ?? firstOfMonth, to: shown.at(-1) ?? firstOfMonth }),
      ]);
      const data = mergeMonths(months);
      if (wanted.current === asked) {
        setMonth({ of: asked, data, changes });
        onReady?.();
      }
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, firstOfMonth, firstOfWeek, errorText, onReady]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (month === null) return <Spinner page />;

  // Until the answer for this month arrives, the squares are drawn with nothing
  // said about them rather than with what was true of another month.
  const known = month.of === reading ? month.data : null;
  const shownChanges = month.of === reading ? changesFor(month.changes, scope) : [];

  const chosen = from === null ? [] : datesBetween(from, to ?? from);
  const weeks = firstOfWeek === null ? weeksOf(firstOfMonth) : [weekFrom(firstOfWeek)];
  const today = todayIn(business.timeZone);

  /** Which calendars a change made here would touch. */
  const touching = scope === null ? onOffer : onOffer.filter((one) => one.id === scope);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        role="grid"
        aria-label={monthName(firstOfMonth, business.timeZone, language)}
        style={{ display: "flex", flexDirection: "column", gap: 3 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 3,
            fontSize: 10.5,
            color: "var(--faint)",
            textAlign: "center",
          }}
        >
          {copy.dayShort.map((short) => (
            <span key={short}>{short}</span>
          ))}
        </div>

        {weeks.map((week, row) => (
          <div key={row} style={{ position: "relative" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
              {week.map((date, column) =>
                date === null ? (
                  <span key={`blank-${column}`} />
                ) : (
                  <DaySquare
                    key={date}
                    date={date}
                    weather={known === null ? "open" : weatherOn(known, date, scope)}
                    facts={known === null ? nothingKnown(date) : factsOn(known, date)}
                    calendars={touching}
                    chosen={chosen.includes(date)}
                    edge={date === from || date === to}
                    today={date === today}
                    reading={date === selected}
                    label={formatLocalDate(date, language, { day: "numeric" })}
                    closedWord={copy.closedWord}
                    disabled={choosing !== null && date < today}
                    onClick={() => {
                      if (choosing === null) {
                        // Reading: the timeline below follows the tap, and
                        // nothing else happens.
                        setFrom(null);
                        setTo(null);
                        onPickDay(date);
                        return;
                      }
                      if (choosing.single === true || from === null || to !== null) {
                        setFrom(date);
                        setTo(null);
                        return;
                      }
                      setTo(date);
                    }}
                  />
                ),
              )}
            </div>

            {/* What was decided about these days, written across them.

                The bands belong on the grid — a holiday is one bar over the
                days it covers, and that is the whole reason it reads as one
                decision. What they must not do is cover the days, or change
                how tall a week is: every square keeps a strip at its foot for
                them, so the month has exactly one rhythm whether or not
                anything is happening. Two lines fit in that strip; anything
                else becomes a count that opens the week. */}
            <ChangeBands
              week={week}
              row={row}
              changes={shownChanges}
              calendars={onOffer}
              onOpen={onOpenChange}
              onOpenWeek={() => setOpenWeek(row)}
            />
          </div>
        ))}
      </div>

      {error !== null && <Critical>{error}</Critical>}

      {/* While an action is being aimed: what it is, what has been picked, and
          the two ways out. Nothing else, because the action was already
          chosen — this step is only "at which days". */}
      {choosing !== null && (
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="label">{choosing.title}</span>
          {from === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="hint">{copy.chooseDays}</span>
              <span className="hint">{copy.cannotDoInThePast}</span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>
                {to === null
                  ? formatLocalDate(from, language, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : `${formatLocalDate(chosen[0] ?? from, language, {
                      day: "numeric",
                      month: "long",
                    })} – ${formatLocalDate(chosen[chosen.length - 1] ?? to, language, {
                      day: "numeric",
                      month: "long",
                    })}`}
              </span>
              {choosing.single !== true && (
                <span
                  className="tab"
                  style={{ fontSize: 12.5, color: "var(--accent-strong)" }}
                >
                  {chosen.length} {copy.daysWord}
                </span>
              )}
            </div>
          )}
          {choosing.single === true ? (
            <span className="hint">{copy.oneDayOnly}</span>
          ) : (
            from !== null && to === null && <span className="hint">{copy.orTapAnother}</span>
          )}

          <Button disabled={from === null} onClick={() => onChosen(chosen)}>
            {copy.continueWord}
          </Button>
          <Button
            intent="quiet"
            onClick={() => {
              setFrom(null);
              setTo(null);
              onCancelChoosing();
            }}
          >
            {copy.cancelSelection}
          </Button>
        </Card>
      )}

      {/* Everything decided about one week, when the grid could not carry it.
          A list rather than more bars: past two lines the bands stop being a
          glance and start hiding the days they describe. */}
      <Sheet open={openWeek !== null} onClose={() => setOpenWeek(null)}>
        {openWeek !== null && (
          <WeekChanges
            week={weeks[openWeek] ?? []}
            changes={shownChanges}
            calendars={onOffer}
            onOpen={(change) => {
              setOpenWeek(null);
              onOpenChange(change);
            }}
          />
        )}
      </Sheet>
    </div>
  );
};

/**
 * One square. The shop's own weather is the fill, because that is what a
 * customer meets; who is busy is the row of marks underneath.
 */
const DaySquare = ({
  date,
  weather,
  facts,
  calendars,
  chosen,
  edge,
  today,
  reading,
  label,
  disabled,
  closedWord,
  onClick,
}: {
  date: string;
  weather: Weather;
  facts: ReturnType<typeof factsOn>;
  calendars: readonly ResourceDto[];
  chosen: boolean;
  edge: boolean;
  today: boolean;
  /** The day the timeline below is showing. */
  reading: boolean;
  /** A day that has been and gone, while an action is being aimed at days. */
  disabled: boolean;
  label: string;
  /** What a day nobody works says on it. */
  closedWord: string;
  onClick: () => void;
}) => {
  // A decision is solid and dark; the week's own shape is a quiet hatch. Both
  // say "closed", and only one of them is anybody's doing.
  const background =
    weather === "shut"
      ? "var(--closed)"
      : weather === "resting"
        ? "repeating-linear-gradient(135deg,var(--line) 0 1.5px,var(--sunken) 1.5px 7px)"
        : chosen
          ? "var(--accent-soft)"
          : weather === "short"
            ? "var(--accent-soft)"
            : "var(--raised)";
  const colour =
    weather === "shut"
      ? "var(--on-accent)"
      : weather === "short"
        ? "var(--accent-strong)"
        : weather === "resting"
          ? "var(--faint)"
          : "var(--ink)";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={date}
      aria-pressed={chosen}
      style={{
        position: "relative",
        // Height is set, width is whatever a seventh of the month is. They used
        // to be square, which with a minimum height made every column at least
        // that wide too — the grid then overflowed its row, and the bands,
        // which are positioned against the row, stopped lining up with the
        // days they cover. A month is seven columns wide, never more.
        // Bigger, now that the search and the filter share the toolbar above
        // rather than taking a row of their own.
        minHeight: 72,
        paddingBottom: BAND_AREA,
        borderRadius: 10,
        background,
        color: colour,
        border: `1px solid ${
          weather === "shut" ? "var(--closed)" : chosen ? "var(--accent)" : "var(--line)"
        }`,
        outline: edge || reading ? "2px solid var(--accent)" : undefined,
        outlineOffset: 1,
        boxShadow: today ? "inset 0 0 0 1px var(--critical)" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 4,
        gap: 3,
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span>{label}</span>
      {/* Said, not implied. A pale square reads as disabled; the word is what
          makes it read as the shop being shut that day. */}
      {weather === "resting" && (
        <span
          style={{
            position: "absolute",
            bottom: BAND_AREA + 1,
            fontSize: 8.5,
            fontWeight: 600,
            color: "var(--muted)",
          }}
        >
          {closedWord}
        </span>
      )}
      {weather !== "shut" && weather !== "resting" && (
        <span style={{ display: "flex", gap: 2, position: "absolute", bottom: BAND_AREA + 2 }}>
          {/* One mark per calendar, in that calendar's own colour, so a row of
              them says who is busy rather than only how busy the day is. How
              busy is the weight: solid for a full day, lighter for a quiet one,
              and an empty outline for a day with nothing on it at all. */}
          {calendars.map((resource, index) => {
            const line = facts.byCalendar.find((one) => one.resourceId === resource.id);
            const busy = line?.appointments ?? 0;
            const mine = laneColourOf(index);
            return (
              <i
                key={resource.id}
                title={resource.name}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  display: "block",
                  background: busy > 0 ? mine : "transparent",
                  border: busy > 0 ? "none" : `1px solid var(--line)`,
                  opacity: line?.away === true ? 0.35 : busy >= 3 ? 1 : busy > 0 ? 0.6 : 1,
                }}
              />
            );
          })}
        </span>
      )}
    </button>
  );
};
