"use client";

import { useState } from "react";
import type { TimeRange } from "@tor-now/domain";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Button, Sheet } from "../ui.tsx";
import { calendarPhrase } from "./change-model.ts";
import { ListCard, ListRow, ListTag } from "./list-ui.tsx";
import { dayLineOf, nothingSet, tooManyDiffer } from "./schedule-model.ts";
import { Stretches } from "./stretches.tsx";
import { exceptionsTo, isUsable, usualOf } from "./usual-week.ts";
import { DEFAULT_OPENING, type DayHours } from "./week.ts";

// The week model moved to week.ts, where it can be tested without a renderer.
// The screens still reach it through this file, which is the thing they think
// they are using.
export {
  DEFAULT_OPENING,
  DEFAULT_OPEN_DAYS,
  emptyWeek,
  rangesFor,
  weekFromRanges,
} from "./week.ts";
export type { DayHours } from "./week.ts";

/**
 * A week of working hours, said the way a person says it.
 *
 * "I'm open nine to five, Friday till one, closed Saturday" leads with the
 * usual and then names what departs from it. So does this: one card for the
 * hours most days keep, with the timeline under them and the days they apply
 * to, and one short row for each day that does something else — a day off
 * included. A row opens that day alone, in a sheet, rather than every day that
 * differs being an open editor down the page.
 *
 * There is one copy of every fact: change the usual and every day on it moves,
 * because those days *are* the usual rather than a copy taken from it.
 *
 * ADR 0002 is untouched. The store keeps ranges per weekday and knows nothing
 * of a "usual" — that is worked out on the way in (see usual-week.ts) and
 * written back as plain ranges on the way out.
 */

/** One day changed, the rest untouched. */
const atDay = (week: DayHours[], dayOfWeek: number, change: (day: DayHours) => DayHours): DayHours[] =>
  week.map((day, index) => (index === dayOfWeek ? change(day) : day));

const copies = (ranges: readonly TimeRange[]): TimeRange[] => ranges.map((range) => ({ ...range }));

export const WeeklyHours = ({
  hours,
  setHours,
  calendar,
}: {
  hours: DayHours[];
  setHours: (hours: DayHours[]) => void;
  /** The calendar the week is for; absent in the wizard, before there is one to name. */
  calendar?: string;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("schedule");
  const changeWords = useCopy("change");
  /**
   * Days the owner has pulled out of the usual by hand. Not stored: it only
   * keeps a day from being swallowed back into the group while its hours still
   * happen to match, which would read as the screen undoing the tap — a row
   * jumping away under the finger.
   */
  const [apart, setApart] = useState<number[]>([]);
  const [dayByDay, setDayByDay] = useState(false);
  const [openDay, setOpenDay] = useState<number | null>(null);
  /** The hours a day gets when it joins a usual no day keeps yet. */
  const [pending, setPending] = useState<TimeRange[]>([{ ...DEFAULT_OPENING }]);

  const usual = usualOf(hours, apart);
  const exceptions = exceptionsTo(usual);
  const unset = nothingSet(hours);
  const usualRanges = usual.days.length > 0 ? usual.ranges : pending;

  const setDay = (dayOfWeek: number, change: (day: DayHours) => DayHours) => setHours(atDay(hours, dayOfWeek, change));

  /** The usual is the days themselves, so editing it edits all of them. */
  const setUsualRanges = (ranges: TimeRange[]) => {
    if (usual.days.length === 0) {
      setPending(ranges);
      return;
    }
    // Pin the days that already differ. Move the usual to nine-to-one and a
    // Friday that already closed at one would match it, be swallowed into the
    // group, and vanish from the list of days that differ.
    const pinned = exceptions.filter((day) => hours[day]?.open === true);
    if (pinned.some((day) => !apart.includes(day))) setApart([...new Set([...apart, ...pinned])]);
    setHours(
      hours.map((day, dayOfWeek) =>
        // A copy each: sharing one array between five days is a mutation away
        // from editing Monday by editing Tuesday.
        usual.days.includes(dayOfWeek) ? { ...day, ranges: copies(ranges) } : day,
      ),
    );
  };

  const joinTheUsual = (dayOfWeek: number) => {
    setApart(apart.filter((day) => day !== dayOfWeek));
    setDay(dayOfWeek, () => ({ open: true, ranges: copies(usualRanges) }));
  };

  /**
   * A day leaves the usual keeping the hours it had: "this day is different"
   * is not "this day is off". Closing is the owner's own tap, in the day's
   * sheet.
   */
  const leaveTheUsual = (dayOfWeek: number, open = true) => {
    if (!apart.includes(dayOfWeek)) setApart([...apart, dayOfWeek]);
    setDay(dayOfWeek, (day) => ({
      open,
      ranges: day.ranges.length > 0 ? day.ranges : copies(usualRanges),
    }));
  };

  const dayRow = (dayOfWeek: number) => {
    const day = hours[dayOfWeek];
    if (day === undefined) return null;
    const line = dayLineOf(day);
    const name = copy.days[dayOfWeek] ?? "";
    return (
      <ListRow
        key={dayOfWeek}
        title={name}
        line={line.kind === "off" ? words.dayOff : <span dir="ltr">{line.text}</span>}
        tags={line.kind === "hours" && line.incomplete ? <ListTag text={words.incomplete} tone="caution" /> : undefined}
        muted={line.kind === "off"}
        label={fillText(words.openDay, { day: name })}
        onClick={() => setOpenDay(dayOfWeek)}
      />
    );
  };

  const sheet = (
    <DaySheet
      dayOfWeek={openDay}
      day={openDay === null ? undefined : hours[openDay]}
      calendar={calendar === undefined ? undefined : calendarPhrase(calendar, changeWords)}
      canRejoin={openDay !== null && usual.days.length > 0 && !usual.days.includes(openDay)}
      onOpen={(open) => openDay !== null && leaveTheUsual(openDay, open)}
      onRanges={(ranges) => openDay !== null && setDay(openDay, (found) => ({ ...found, ranges }))}
      onRejoin={() => {
        if (openDay !== null) joinTheUsual(openDay);
        setOpenDay(null);
      }}
      onClose={() => setOpenDay(null)}
    />
  );

  if (dayByDay) {
    return (
      <>
        <section className="week-card" aria-labelledby="day-by-day-title">
          <header>
            <h3 id="day-by-day-title">{words.dayByDayTitle}</h3>
            <p>{words.dayByDaySub}</p>
          </header>
          <ListCard labelledBy="day-by-day-title">{hours.map((_day, dayOfWeek) => dayRow(dayOfWeek))}</ListCard>
        </section>
        <Button intent="quiet" onClick={() => setDayByDay(false)}>
          {words.backToUsualView}
        </Button>
        {sheet}
      </>
    );
  }

  return (
    <>
      <section className="week-card" aria-labelledby="usual-title">
        <header>
          <h3 id="usual-title">{unset ? words.nothingYetTitle : words.usualTitle}</h3>
          <p>{unset ? words.nothingYetWhy : usual.days.length === 0 ? words.noUsualDays : words.usualSub}</p>
        </header>

        <Stretches id="usual" ranges={copies(usualRanges)} setRanges={setUsualRanges} />

        <div className="week-days">
          <span id="which-days" className="week-label">
            {words.whichDays}
          </span>
          <div role="group" aria-labelledby="which-days" className="day-dots">
            {copy.dayShort.map((short, dayOfWeek) => {
              const following = usual.days.includes(dayOfWeek);
              return (
                <button
                  key={dayOfWeek}
                  type="button"
                  aria-pressed={following}
                  aria-label={copy.days[dayOfWeek]}
                  onClick={() => (following ? leaveTheUsual(dayOfWeek) : joinTheUsual(dayOfWeek))}
                >
                  {short}
                </button>
              );
            })}
          </div>
          {unset && <p className="week-hint">{words.chooseADay}</p>}
        </div>
      </section>

      {!unset && exceptions.length > 0 && (
        <section className="week-card" aria-labelledby="other-days-title">
          <header>
            <h3 id="other-days-title">{words.otherDaysTitle}</h3>
            <p>{words.otherDaysSub}</p>
          </header>
          {tooManyDiffer(hours, exceptions) && (
            <div className="week-many">
              <p className="warn" style={{ margin: 0 }}>
                {words.manyDiffer}
              </p>
              <button type="button" className="text-link" onClick={() => setDayByDay(true)}>
                {words.dayByDay}
              </button>
            </div>
          )}
          <ListCard labelledBy="other-days-title">{exceptions.map(dayRow)}</ListCard>
        </section>
      )}

      {sheet}
    </>
  );
};

/**
 * One day that differs, alone: worked or not, its hours with their timeline,
 * and the way back to the usual. Its edits are the week's as they are made;
 * "אישור" only closes it, and the screen's one save writes them.
 */
const DaySheet = ({
  dayOfWeek,
  day,
  calendar,
  canRejoin,
  onOpen,
  onRanges,
  onRejoin,
  onClose,
}: {
  dayOfWeek: number | null;
  day: DayHours | undefined;
  /** "ביומן של דנה", or absent in the wizard. */
  calendar: string | undefined;
  canRejoin: boolean;
  onOpen: (open: boolean) => void;
  onRanges: (ranges: TimeRange[]) => void;
  onRejoin: () => void;
  onClose: () => void;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("schedule");
  const name = dayOfWeek === null ? "" : (copy.days[dayOfWeek] ?? "");
  const complete = day === undefined || !day.open || (day.ranges.length > 0 && day.ranges.every(isUsable));
  return (
    <Sheet open={dayOfWeek !== null && day !== undefined} onClose={onClose} labelledBy="day-sheet-title">
      {day !== undefined && dayOfWeek !== null && (
        <div className="day-sheet">
          <h2 id="day-sheet-title">{name}</h2>
          <p className="week-explain">
            {calendar === undefined
              ? fillText(words.daySheetLineWizard, { day: name })
              : fillText(words.daySheetLine, { day: name, calendar })}
          </p>
          <div className="day-choice">
            <button type="button" aria-pressed={!day.open} onClick={() => onOpen(false)}>
              {words.notWorking}
            </button>
            <button type="button" aria-pressed={day.open} onClick={() => onOpen(true)}>
              {words.otherHours}
            </button>
          </div>
          {day.open && <Stretches id={`day-${dayOfWeek}`} ranges={day.ranges} setRanges={onRanges} />}
          {!complete && (
            <p className="warn" style={{ margin: 0 }}>
              {words.fixTheHours}
            </p>
          )}
          <Button disabled={!complete} onClick={onClose}>
            {words.confirm}
          </Button>
          {canRejoin && (
            <button type="button" className="text-link centred" onClick={onRejoin}>
              {words.rejoin}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
};
