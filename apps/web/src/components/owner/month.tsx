"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  BusinessMonthDto,
  ClosureBandDto,
  ResourceDto,
} from "@/lib/api/types.ts";
import { formatLocalDate, monthName, todayIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { canCloseBusiness } from "@/lib/roles.ts";
import { laneColourOf } from "./event-colour.ts";
import { Button, Card, Critical, Note, Sheet, Spinner } from "../ui.tsx";
import { datesBetween, factsOn, labelFor, segmentIn, weeksOf } from "./month-model.ts";

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

/** The shade of a square: what the shop is doing, before who is busy. */
type Weather = "open" | "short" | "shut";

const weatherOn = (month: BusinessMonthDto, date: string): Weather => {
  const facts = factsOn(month, date);
  if (facts.shopClosed) return "shut";
  return facts.shopHours.length > 0 ? "short" : "open";
};

export const Month = ({
  token,
  business,
  resources,
  scope,
  selected,
  onPickDay,
  reloadKey,
  choosing,
  onChosen,
  onCancelChoosing,
  onChanged,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** Which calendar the screen is reading, or null for all of them. */
  scope: string | null;
  /** The day the timeline below is showing, so the grid can mark it. */
  selected: string;
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
  choosing: { readonly title: string } | null;
  onChosen: (dates: readonly string[]) => void;
  onCancelChoosing: () => void;
  /**
   * Something here changed the calendar.
   *
   * The month reloads itself, but the day below it is a different read of the
   * same thing — taking a blockage off here used to leave it sitting on the
   * open day until the screen was reopened.
   */
  onChanged: () => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [firstOfMonth, setFirstOfMonth] = useState(
    () => `${todayIn(business.timeZone).slice(0, 7)}-01`,
  );
  const [month, setMonth] = useState<BusinessMonthDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The two taps. The second one turns a day into a range. */
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<BusinessMonthDto["blockages"][number] | null>(null);
  /** A run of shut days, opened to be read or given back. */
  const [openClosure, setOpenClosure] = useState<ClosureBandDto | null>(null);

  const onOffer = resources.filter((resource) => resource.active !== false);
  const many = onOffer.length > 1;

  const load = useCallback(async () => {
    setError(null);
    try {
      setMonth(await api.businessMonth(token, business.id, firstOfMonth));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, firstOfMonth, errorText]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setFrom(null);
      setTo(null);
      setOpenGroup(null);
      setOpenClosure(null);
      await load();
      // The day below is another read of what just changed.
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (month === null) return <Spinner />;

  const chosen = from === null ? [] : datesBetween(from, to ?? from);
  const weeks = weeksOf(firstOfMonth);
  const today = todayIn(business.timeZone);

  /** Which calendars a change made here would touch. */
  const touching = scope === null ? onOffer : onOffer.filter((one) => one.id === scope);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="chip tap"
          aria-label={copy.previousMonth}
          onClick={() => setFirstOfMonth(shiftMonth(firstOfMonth, -1))}
          style={{ minWidth: 44 }}
        >
          ‹
        </button>
        <span style={{ flex: 1, textAlign: "center", fontWeight: 600 }}>
          {monthName(firstOfMonth, business.timeZone, language)}
        </span>
        <button
          className="chip tap"
          aria-label={copy.nextMonth}
          onClick={() => setFirstOfMonth(shiftMonth(firstOfMonth, 1))}
          style={{ minWidth: 44 }}
        >
          ›
        </button>
      </div>

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
                    weather={weatherOn(month, date)}
                    facts={factsOn(month, date)}
                    calendars={touching}
                    chosen={chosen.includes(date)}
                    edge={date === from || date === to}
                    today={date === today}
                    reading={date === selected}
                    label={formatLocalDate(date, language, { day: "numeric" })}
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
                      if (from === null || to !== null) {
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

            {/* Anything covering more than one day is drawn as one bar across
                those days: a holiday is one decision and should look like it. */}
            <div
              style={{
                position: "absolute",
                insetInline: 0,
                bottom: 3,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                pointerEvents: "none",
              }}
            >
              {/* The shop's own closures first: they cover every calendar, so
                  they are the widest claim being made about those days. */}
              {/* One day counts. A single shut Sunday is as much a decision as
                  a week away, and leaving it to a pale square meant there was
                  nothing to read and nothing to tap. */}
              {month.closures
                .map((closure) => segmentIn(week, closure))
                .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
                .map(({ span, column, width }) => (
                  <span
                    key={`closed-${span.fromDate}-${row}`}
                    style={{ position: "relative", height: 13 }}
                  >
                    <button
                      onClick={() => setOpenClosure(span)}
                      style={{
                        position: "absolute",
                        insetInlineStart: `calc(${(column / 7) * 100}% + 2px)`,
                        width: `calc(${(width / 7) * 100}% - 4px)`,
                        height: 13,
                        borderRadius: 999,
                        background:
                          span.kind === "SHUT" ? "var(--closed)" : "var(--accent-soft)",
                        color: span.kind === "SHUT" ? "var(--on-accent)" : "var(--accent-strong)",
                        border:
                          span.kind === "SHUT" ? "none" : "1px solid var(--accent)",
                        fontSize: 9,
                        fontWeight: 600,
                        pointerEvents: "auto",
                        padding: "0 5px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {labelFor(
                        span.note,
                        width,
                        span.kind === "SHUT"
                          ? copy.closedWord
                          : span.hours
                              .map((range) => `${range.start}–${range.end}`)
                              .join(", "),
                      )}
                    </button>
                  </span>
                ))}

              {month.blockages
                .filter((blockage) => scope === null || blockage.resourceId === scope)
                .map((blockage) => segmentIn(week, blockage))
                .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
                .map(({ span, column, width }) => {
                  // Whose time this is. A band that says only "away" leaves the
                  // owner of a three-chair shop to work out which chair — so
                  // the calendar's own mark leads, in the colour it wears
                  // everywhere else, and the reason follows it.
                  const whose = onOffer.findIndex((one) => one.id === span.resourceId);
                  const named = onOffer[whose]?.name ?? "";
                  return (
                    <span
                      key={`${span.groupId}-${row}`}
                      style={{ position: "relative", height: 13 }}
                    >
                      <button
                        onClick={() => setOpenGroup(span)}
                        style={{
                          position: "absolute",
                          insetInlineStart: `calc(${(column / 7) * 100}% + 2px)`,
                          width: `calc(${(width / 7) * 100}% - 4px)`,
                          height: 13,
                          borderRadius: 999,
                          background: "var(--blocked-soft)",
                          border: `1px solid ${laneColourOf(whose)}`,
                          color: "var(--ink)",
                          fontSize: 9,
                          fontWeight: 600,
                          pointerEvents: "auto",
                          padding: "0 5px",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                        }}
                      >
                        {many && (
                          <i
                            aria-hidden="true"
                            style={{
                              width: 9,
                              height: 9,
                              borderRadius: 999,
                              flexShrink: 0,
                              background: laneColourOf(whose),
                            }}
                          />
                        )}
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {many
                            ? `${named} · ${labelFor(span.reason, width, copy.blockedShort)}`
                            : labelFor(span.reason, width, copy.blockedShort)}
                        </span>
                      </button>
                    </span>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <Legend copy={copy} many={many} />
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
              <span className="tab" style={{ fontSize: 12.5, color: "var(--accent-strong)" }}>
                {chosen.length} {copy.daysWord}
              </span>
            </div>
          )}
          {from !== null && to === null && <span className="hint">{copy.orTapAnother}</span>}

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

      {/* A closure, as the one decision it was — and the way back out of it. */}
      <Sheet open={openClosure !== null} onClose={() => setOpenClosure(null)}>
        {openClosure !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 18 }}>
              {openClosure.note ??
                (openClosure.kind === "SHUT" ? copy.closedWord : copy.differentHours)}
            </h2>
            {/* What the shop is actually doing that day — the half-day was the
                case with nothing to read at all. */}
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }} className="tab">
              {openClosure.kind === "SHUT"
                ? copy.closedAllDay
                : openClosure.hours
                    .map((range) => `${range.start}–${range.end}`)
                    .join(" · ")}
            </p>
            <p className="hint" style={{ margin: 0 }}>
              {formatLocalDate(openClosure.fromDate, language, { day: "numeric", month: "long" })}
              {" – "}
              {formatLocalDate(openClosure.toDate, language, { day: "numeric", month: "long" })}
              {" · "}
              {openClosure.days} {copy.daysWord}
              {" · "}
              {copy.allCalendars}
            </p>
            {/* Re-opening the days does not un-cancel what closing them called
                off — those customers were told — and saying so here is better
                than an owner finding out by looking. */}
            <Note>{copy.reopenKeepsCancellations}</Note>
            {canCloseBusiness(business) && (
              <Button
                intent="danger"
                busy={busy}
                onClick={() =>
                  void act(() =>
                    api.reopenBusiness(
                      token,
                      business.id,
                      openClosure.fromDate,
                      openClosure.toDate,
                    ),
                  )
                }
              >
                {openClosure.days === 1
                  ? copy.reopenOneDay
                  : copy.reopenDays.replace("{days}", String(openClosure.days))}
              </Button>
            )}
          </div>
        )}
      </Sheet>

      {/* A blockage, as the one thing it was. */}
      <Sheet open={openGroup !== null} onClose={() => setOpenGroup(null)}>
        {openGroup !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 18 }}>{openGroup.reason || copy.blockedWord}</h2>
            {/* Whose calendar it is, said before anything else: "away" is not
                an answer in a shop with three chairs. */}
            <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 7 }}>
              <i
                aria-hidden="true"
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 999,
                  background: laneColourOf(
                    onOffer.findIndex((one) => one.id === openGroup.resourceId),
                  ),
                }}
              />
              <b style={{ fontWeight: 600, fontSize: 14 }}>
                {onOffer.find((one) => one.id === openGroup.resourceId)?.name ?? ""}
              </b>
            </p>
            <p className="hint" style={{ margin: 0 }}>
              {formatLocalDate(openGroup.fromDate, language, { day: "numeric", month: "long" })}
              {" – "}
              {formatLocalDate(openGroup.toDate, language, { day: "numeric", month: "long" })}
              {" · "}
              {openGroup.days} {copy.daysWord}
            </p>
            <Button
              intent="danger"
              busy={busy}
              onClick={() =>
                void act(() => api.deleteBlockGroup(token, business.id, openGroup.groupId))
              }
            >
              {copy.removeWholeBlockage.replace("{days}", String(openGroup.days))}
            </Button>
          </div>
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
  onClick: () => void;
}) => {
  const background =
    weather === "shut"
      ? "var(--closed)"
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
        : "var(--ink)";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={date}
      aria-pressed={chosen}
      style={{
        position: "relative",
        aspectRatio: "1",
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
        gap: 2,
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span>{label}</span>
      {weather !== "shut" && (
        <span style={{ display: "flex", gap: 2, position: "absolute", bottom: 14 }}>
          {calendars.map((resource) => {
            const line = facts.byCalendar.find((one) => one.resourceId === resource.id);
            const busy = line?.appointments ?? 0;
            return (
              <i
                key={resource.id}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 999,
                  display: "block",
                  background:
                    line?.away === true
                      ? "var(--blocked)"
                      : busy >= 3
                        ? "var(--accent-strong)"
                        : busy > 0
                          ? "var(--faint)"
                          : "var(--line)",
                }}
              />
            );
          })}
        </span>
      )}
    </button>
  );
};

const Legend = ({
  copy,
  many,
}: {
  copy: ReturnType<typeof useCopy<"owner">>;
  many: boolean;
}) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10.5, color: "var(--muted)" }}>
    <Key colour="var(--closed)" label={copy.closedAllDay} />
    <Key colour="var(--accent-soft)" label={copy.differentHours} />
    {many && <Key colour="var(--blocked)" label={copy.blockedWord} />}
    <Key colour="var(--accent-strong)" label={copy.appointmentsWord} />
  </div>
);

const Key = ({ colour, label }: { colour: string; label: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
    <i
      style={{
        width: 11,
        height: 11,
        borderRadius: 3,
        display: "inline-block",
        background: colour,
        border: "1px solid var(--line)",
      }}
    />
    <span>{label}</span>
  </span>
);

/** The first of the month, moved by whole months. */
const shiftMonth = (firstOfMonth: string, by: number): string => {
  const [year, month] = firstOfMonth.split("-").map(Number) as [number, number];
  const moved = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
