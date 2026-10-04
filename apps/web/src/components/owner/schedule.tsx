"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ChangeDto, ResourceDto, WorkingHoursDto } from "@/lib/api/types.ts";
import { addDaysTo, todayIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Empty, Spinner } from "../ui.tsx";
import { useCalendarChanges } from "./change-host.tsx";
import { calendarPhrase, rowOf } from "./change-model.ts";
import { emptyWeek, rangesFor, weekFromRanges, WeeklyHours, type DayHours } from "./weekly-hours.tsx";
import { weekIsUsable } from "./usual-week.ts";

/**
 * The schedule: the usual week, and the changes to it.
 *
 * "שעות קבועות" is ADR 0002's recurring layer, edited as a week. "שינויים" is
 * every change to a day — a day off, some hours off, other hours — for one
 * calendar or for the whole business, in one list, each row the same sentence
 * shortened. A calendar shows only its own changes; the business's are under
 * "כל העסק", where a worker reads them and an owner or manager also makes them.
 */
type Tab = "usual" | "changes";

/** What the list reads ahead: the longest change made at once. */
const CHANGES_AHEAD_DAYS = 365;

const BUSINESS = "BUSINESS";

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
  const copy = useCopy("owner");
  const changeCopy = useCopy("change");
  const { language } = useLanguage();
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

  const onOffer = resources.filter((resource) => resource.active !== false);
  const many = onOffer.length > 1;
  const resource =
    scope === null || scope === BUSINESS ? null : (onOffer.find((one) => one.id === scope) ?? null);

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

  /** The week as edited, in place of the week that was there. */
  const saveWeek = async () => {
    if (resource === null || hours === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.replaceWorkingHours(token, business.id, resource.id, week.flatMap((day, dayOfWeek) => rangesFor(day, dayOfWeek)));
      setSaved(true);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (scope === null) return <Spinner />;

  const shown = (changes ?? []).filter((change) =>
    scope === BUSINESS ? change.scope.kind === "BUSINESS" : change.scope.kind === "CALENDAR" && change.scope.resourceId === scope,
  );
  const mayAdd = scope !== BUSINESS || sheets.who.manages;

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* What, then whose: the two views first, and the calendars under them —
          "כל העסק" is one of those only where the business has something of
          its own, its changes; the usual week is always a calendar's. */}
      <div role="tablist" style={{ display: "flex", gap: 6 }}>
        {(["usual", "changes"] as const).map((candidate) => (
          <button
            key={candidate}
            role="tab"
            aria-selected={tab === candidate}
            className="chip"
            onClick={() => {
              setTab(candidate);
              // The usual week is a calendar's; the business has none of its own.
              if (candidate === "usual" && scope === BUSINESS) setScope(onOffer[0]?.id ?? null);
            }}
            style={{
              flex: 1,
              background: tab === candidate ? "var(--accent-soft)" : "transparent",
              color: tab === candidate ? "var(--accent-strong)" : "var(--muted)",
              border: `1px solid ${tab === candidate ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {candidate === "usual" ? changeCopy.tabUsual : changeCopy.tabChanges}
          </button>
        ))}
      </div>

      {many && (
        <div role="group" aria-label={tab === "changes" ? changeCopy.scopeLabel : changeCopy.calendarLabel} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tab === "changes" && (
            <ScopeChip chosen={scope === BUSINESS} business onClick={() => setScope(BUSINESS)}>
              {changeCopy.wholeBusiness}
            </ScopeChip>
          )}
          {onOffer.map((candidate) => (
            <ScopeChip key={candidate.id} chosen={candidate.id === scope} onClick={() => setScope(candidate.id)}>
              {candidate.name}
            </ScopeChip>
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
            <WeeklyHours key={resource.id} hours={week} setHours={setWeek} />
            {saved && (
              <p className="hint" role="status" style={{ margin: 0 }}>
                {copy.settingsSaved}
              </p>
            )}
            {!weekIsUsable(week) && <p className="warn" style={{ margin: 0 }}>{copy.fixTheHours}</p>}
            <Button busy={busy} disabled={!weekIsUsable(week)} onClick={() => void saveWeek()}>
              {copy.save}
            </Button>
          </>
        ))}

      {tab === "changes" &&
        (changes === null ? (
          <Spinner />
        ) : (
          <>
            {shown.length === 0 ? (
              <Empty title={changeCopy.noChanges} />
            ) : (
              <ul aria-label={changeCopy.listLabel} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {shown.map((change) => {
                  const row = rowOf(change, changeCopy, language);
                  return (
                    <li key={change.id}>
                      <button className="change-row" onClick={() => sheets.showChange(change, null)}>
                        <span className="when">{row.when}</span>
                        <span className="what">
                          <b>{row.what}</b>
                          {row.note !== null && <small>{row.note}</small>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {mayAdd && (
              <Button
                intent="quiet"
                onClick={() =>
                  sheets.openSheet({
                    kind: "typed",
                    date: todayIn(business.timeZone),
                    scope: scope === BUSINESS ? { kind: "BUSINESS" } : { kind: "CALENDAR", resourceId: scope },
                  })
                }
              >
                {scope === BUSINESS
                  ? changeCopy.addForBusiness
                  : changeCopy.addFor.replace("{calendar}", calendarPhrase(resource?.name ?? "", changeCopy))}
              </Button>
            )}
          </>
        ))}

      {sheets.sheets}
    </div>
  );
};

const ScopeChip = ({
  chosen,
  business = false,
  onClick,
  children,
}: {
  chosen: boolean;
  business?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    className={business ? "chip change-business" : "chip"}
    onClick={onClick}
    aria-pressed={chosen}
    style={{
      background: chosen ? "var(--accent)" : "var(--raised)",
      color: chosen ? "var(--on-accent)" : "var(--ink)",
      border: `1px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
    }}
  >
    {children}
  </button>
);
