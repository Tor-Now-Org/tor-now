"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ChangeDto, ResourceDto, WorkingHoursDto } from "@/lib/api/types.ts";
import { addDaysTo, todayIn } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Sheet, Spinner } from "../ui.tsx";
import { useCalendarChanges } from "./change-host.tsx";
import { calendarPhrase } from "./change-model.ts";
import { Mark } from "./lane-mark.tsx";
import { ScheduleChanges } from "./schedule-changes.tsx";
import { changesIn, weekDiffers, weekIsSaveable, nothingSet, type ChangeView } from "./schedule-model.ts";
import { emptyWeek, rangesFor, weekFromRanges, WeeklyHours, type DayHours } from "./weekly-hours.tsx";

/**
 * The schedule: the usual week, and the changes to it.
 *
 * "שעות קבועות" is ADR 0002's recurring layer, edited as a week, with one save
 * pinned under it. "שינויים" is every change to a day — a day off, some hours
 * off, other hours — for one calendar or for the whole business. A calendar's
 * list carries the business's changes too, marked, since they change its hours
 * as well; they are made and edited under "כל העסק", where a worker reads them
 * and an owner or manager also makes them. Each tab says in one line what it
 * is for.
 */
type Tab = "usual" | "changes";

/** What the list reads ahead: the longest change made at once. */
const CHANGES_AHEAD_DAYS = 365;

const BUSINESS = "BUSINESS";

/** Where the owner asked to go while the week on screen was unsaved. */
type Leaving = { readonly tab: Tab; readonly scope: string };

export const Schedule = ({
  token,
  business,
  resources,
  openOn,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** A calendar asked for by name, from the calendars panel's edit control. */
  openOn?: string;
}) => {
  const words = useCopy("schedule");
  const changeCopy = useCopy("change");
  const errorText = useErrorText();

  const [tab, setTab] = useState<Tab>("usual");
  /** The calendar on screen, or the whole business — which only the changes have. */
  const [scope, setScope] = useState<string | null>(null);
  const [hours, setHours] = useState<WorkingHoursDto[] | null>(null);
  const [week, setWeek] = useState<DayHours[]>(emptyWeek);
  const [saved, setSaved] = useState(false);
  const [changes, setChanges] = useState<readonly ChangeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freshness, setFreshness] = useState(0);
  const [leaving, setLeaving] = useState<Leaving | null>(null);

  const onOffer = resources.filter((resource) => resource.active !== false);
  const many = onOffer.length > 1;
  const resource =
    scope === null || scope === BUSINESS ? null : (onOffer.find((one) => one.id === scope) ?? null);
  const savedWeek = hours === null ? null : weekFromRanges(hours);
  const unsaved = tab === "usual" && savedWeek !== null && weekDiffers(week, savedWeek);

  // Resources arrive after this mounts, so the selection follows the list.
  // `openOn` is the calendar somebody asked for by name, and wins.
  useEffect(() => {
    setScope((current) => {
      const asked = openOn === undefined ? undefined : onOffer.find((one) => one.id === openOn);
      if (asked !== undefined) return asked.id;
      if (current === BUSINESS && many) return current;
      return current !== null && onOffer.some((one) => one.id === current) ? current : (onOffer[0]?.id ?? null);
    });
    // onOffer is derived from resources on every render; resources is what changes.
  }, [resources, openOn]);

  const sheets = useCalendarChanges({
    token,
    business,
    resources: onOffer,
    onChanged: () => setFreshness((key) => key + 1),
    onShowBusiness: () => setScope(BUSINESS),
  });

  /**
   * A calendar's week belongs to that calendar. Leaving it on screen while the
   * next one is fetched let one chair's hours be edited and saved as another's.
   */
  const loadWeek = useCallback(
    async (isStale: () => boolean) => {
      if (resource === null) return;
      setHours(null);
      setWeek(emptyWeek);
      setSaved(false);
      try {
        const loaded = await api.listWorkingHours(token, business.id, resource.id);
        if (isStale()) return;
        setHours(loaded);
        setWeek(weekFromRanges(loaded));
      } catch (cause) {
        if (!isStale()) setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      }
    },
    [token, business.id, resource, errorText],
  );

  useEffect(() => {
    let stale = false;
    void loadWeek(() => stale);
    return () => {
      stale = true;
    };
  }, [loadWeek]);

  // Every change this person may see, read once for the whole list and
  // narrowed by the chip; read again whenever a change is made or removed.
  useEffect(() => {
    let current = true;
    const from = todayIn(business.timeZone);
    api
      .listChanges(token, business.id, { from, to: addDaysTo(from, CHANGES_AHEAD_DAYS) })
      .then((found) => {
        if (current) setChanges(found);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      });
    return () => {
      current = false;
    };
  }, [token, business.id, business.timeZone, freshness, errorText]);

  /** The week as edited, in place of the week that was there. Whether it went through. */
  const saveWeek = async (): Promise<boolean> => {
    if (resource === null || hours === null) return false;
    setBusy(true);
    setError(null);
    try {
      const written = await api.replaceWorkingHours(
        token,
        business.id,
        resource.id,
        week.flatMap((day, dayOfWeek) => rangesFor(day, dayOfWeek)),
      );
      // What the store keeps is now what is on screen: merged as it was written.
      setHours(written);
      setWeek(weekFromRanges(written));
      setSaved(true);
      return true;
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Moving to another tab or calendar. Another calendar loads its own week;
   * the edits on this one were saved, dropped or never made before this runs.
   */
  const go = (next: Leaving) => {
    if (next.tab === tab && next.scope === scope) return;
    if (next.scope !== scope) setError(null);
    setTab(next.tab);
    setScope(next.scope);
    setSaved(false);
  };

  const ask = (next: Leaving) => (unsaved ? setLeaving(next) : go(next));

  const chooseTab = (candidate: Tab) =>
    ask({
      tab: candidate,
      // The usual week is a calendar's; the business has none of its own.
      scope: candidate === "usual" && scope === BUSINESS ? (onOffer[0]?.id ?? BUSINESS) : (scope ?? BUSINESS),
    });

  if (scope === null) return <Spinner />;

  const view: ChangeView = scope === BUSINESS ? { kind: "BUSINESS" } : { kind: "CALENDAR", resourceId: scope };
  const phrase = resource === null ? "" : calendarPhrase(resource.name, changeCopy);
  const shown = changesIn(changes ?? [], view);
  const mayAdd = scope !== BUSINESS || sheets.who.manages;
  const explain =
    tab === "usual"
      ? fillText(words.explainUsual, { calendar: phrase })
      : scope === BUSINESS
        ? words.explainChangesBusiness
        : many
          ? fillText(words.explainChangesCalendar, { calendar: phrase })
          : words.explainChanges;

  return (
    <div className="schedule">
      {/* What, then whose: the two views first, and the calendars under them —
          "כל העסק" is one of those only where the business has something of
          its own, its changes; the usual week is always a calendar's. */}
      <div role="tablist" className="schedule-tabs">
        {(["usual", "changes"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => chooseTab(candidate)}
          >
            {candidate === "usual" ? changeCopy.tabUsual : changeCopy.tabChanges}
          </button>
        ))}
      </div>

      <p className="week-explain">{explain}</p>

      {many && (
        <div
          role="group"
          aria-label={tab === "changes" ? changeCopy.scopeLabel : changeCopy.calendarLabel}
          className="calendar-chips"
        >
          {tab === "changes" && (
            <button
              type="button"
              className="business"
              aria-pressed={scope === BUSINESS}
              onClick={() => ask({ tab, scope: BUSINESS })}
            >
              {changeCopy.wholeBusiness}
            </button>
          )}
          {onOffer.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === scope}
              onClick={() => ask({ tab, scope: candidate.id })}
            >
              <Mark
                name={candidate.name}
                index={resources.findIndex((one) => one.id === candidate.id)}
                size={22}
              />
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      {error !== null && <Critical>{error}</Critical>}

      {tab === "usual" &&
        (hours === null || resource === null ? (
          <Spinner />
        ) : (
          <>
            {/* Keyed on the calendar: which days were pulled out of the usual
                belongs to the week in front of the owner. */}
            <WeeklyHours key={resource.id} hours={week} setHours={setWeek} calendar={resource.name} />
            <div className="week-save">
              {!nothingSet(week) && !weekIsSaveable(week) && (
                <p className="warn" style={{ margin: 0 }}>
                  {words.fixTheHours}
                </p>
              )}
              <Button busy={busy} disabled={!weekIsSaveable(week)} onClick={() => void saveWeek()}>
                {words.save}
              </Button>
              {saved && !unsaved && (
                <p className="week-saved" role="status">
                  {words.saved}
                </p>
              )}
            </div>
          </>
        ))}

      {tab === "changes" &&
        (changes === null ? (
          <Spinner />
        ) : (
          <ScheduleChanges
            changes={shown}
            view={view}
            addLabel={
              !mayAdd
                ? null
                : scope === BUSINESS
                  ? words.addForBusiness
                  : fillText(words.addFor, { name: resource?.name ?? "" })
            }
            showWorkerFoot={!sheets.who.manages && shown.some((change) => change.scope.kind === "BUSINESS")}
            // With one calendar there is no "כל העסק" to send a business's
            // change to, so it is edited where it is.
            onOpen={(change) => sheets.showChange(change, null, view.kind === "CALENDAR" && many)}
            onAdd={() =>
              sheets.openSheet({
                kind: "typed",
                date: todayIn(business.timeZone),
                scope: scope === BUSINESS ? { kind: "BUSINESS" } : { kind: "CALENDAR", resourceId: scope },
              })
            }
          />
        ))}

      <LeaveSheet
        open={leaving !== null}
        calendar={phrase}
        busy={busy}
        onSave={async () => {
          const next = leaving;
          if (next === null) return;
          setLeaving(null);
          if (await saveWeek()) go(next);
        }}
        onDrop={() => {
          const next = leaving;
          setLeaving(null);
          if (next !== null) {
            if (savedWeek !== null) setWeek(savedWeek);
            go(next);
          }
        }}
        onStay={() => setLeaving(null)}
      />

      {sheets.sheets}
    </div>
  );
};

/** Asked before unsaved hours are left behind, rather than dropping them silently. */
const LeaveSheet = ({
  open,
  calendar,
  busy,
  onSave,
  onDrop,
  onStay,
}: {
  open: boolean;
  calendar: string;
  busy: boolean;
  onSave: () => Promise<void>;
  onDrop: () => void;
  onStay: () => void;
}) => {
  const words = useCopy("schedule");
  return (
    <Sheet open={open} onClose={onStay} labelledBy="leave-title">
      <div className="day-sheet">
        <h2 id="leave-title">{fillText(words.leaveTitle, { calendar })}</h2>
        <p className="week-explain">{words.leaveBody}</p>
        <Button busy={busy} onClick={() => void onSave()}>
          {words.leaveSave}
        </Button>
        <Button intent="quiet" onClick={onDrop}>
          {words.leaveDrop}
        </Button>
        <button type="button" className="text-link centred" onClick={onStay}>
          {words.leaveStay}
        </button>
      </div>
    </Sheet>
  );
};
