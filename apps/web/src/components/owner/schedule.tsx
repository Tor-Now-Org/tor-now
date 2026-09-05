"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BlockDto,
  BusinessDto,
  OverrideDto,
  ResourceDto,
  WorkingHoursDto,
} from "@/lib/api/types.ts";
import { addDaysTo, formatLocalDate, timeIn, todayIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { mergedRanges, TEXT_RULES, type TimeRange } from "@tor-now/domain";
import { useErrorText } from "@/lib/use-error-text.ts";
import { useFieldProblem } from "@/lib/use-field-problem.ts";
import { Button, Card, Critical, Empty, Field, Note, Sheet, Spinner } from "../ui.tsx";
import { Stretches } from "./stretches.tsx";
import { isUsable } from "./usual-week.ts";
import { spansOf } from "./blockage.ts";
import {
  emptyWeek,
  rangesFor,
  weekFromRanges,
  WeeklyHours,
  type DayHours,
} from "./weekly-hours.tsx";
import { weekIsUsable } from "./usual-week.ts";

/**
 * The three schedule layers of ADR 0002, as three tabs — because each has
 * exactly one meaning and mixing them in one editor is what produced the
 * ambiguity the ADR removed.
 */
type Layer = "hours" | "overrides" | "blocks";

const OVERRIDE_WINDOW_DAYS = 90;

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
  const { language } = useLanguage();
  const errorText = useErrorText();
  const problem = useFieldProblem();

  const [layer, setLayer] = useState<Layer>("hours");
  const [resource, setResource] = useState<ResourceDto | null>(null);

  // Resources are fetched by the parent and arrive after this mounts, so the
  // selection cannot come from the initial render alone — it has to follow the
  // list. Without this the screen waits forever for a calendar it already has.
  //
  // `openOn` is the calendar somebody asked for by name, arriving from the
  // calendars panel: it wins over both the current selection and the default,
  // because a person who pressed "edit" on one row means that row.
  useEffect(() => {
    setResource((current) => {
      const asked =
        openOn === undefined
          ? undefined
          : resources.find((candidate) => candidate.id === openOn);
      if (asked !== undefined) return asked;
      return current !== null && resources.some((candidate) => candidate.id === current.id)
        ? current
        : (resources[0] ?? null);
    });
  }, [resources, openOn]);
  const [hours, setHours] = useState<WorkingHoursDto[] | null>(null);
  const [week, setWeek] = useState<DayHours[]>(emptyWeek);
  const [saved, setSaved] = useState(false);
  const [overrides, setOverrides] = useState<OverrideDto[]>([]);
  const [blocks, setBlocks] = useState<BlockDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingRange, setEditingRange] = useState<{ id: string | null; dayOfWeek: number; start: string; end: string } | null>(null);
  /**
   * A special day: which date, and the stretches it is open for. An empty list
   * of stretches is not the same as none — "closed" is the absence of them,
   * which is what ADR 0002 stores, so the two are one choice with a list under
   * it rather than two independent fields.
   */
  const [editingOverride, setEditingOverride] = useState<{
    date: string;
    closed: boolean;
    ranges: TimeRange[];
  } | null>(null);
  /**
   * A blockage: the days it covers, and the hours of each of them. A week away
   * is one decision, and so is an hour kept free every day of that week.
   */
  const [editingBlock, setEditingBlock] = useState<{
    from: string;
    to: string;
    allDay: boolean;
    ranges: TimeRange[];
    reason: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (resource === null) return;
    const from = todayIn(business.timeZone);
    const to = addDaysTo(from, OVERRIDE_WINDOW_DAYS);
    try {
      const [loadedHours, loadedOverrides, calendarDays] = await Promise.all([
        api.listWorkingHours(token, business.id, resource.id),
        api.listOverrides(token, business.id, resource.id, { from, to }),
        api.calendarDay(token, business.id, resource.id, from),
      ]);
      setHours(loadedHours);
      setWeek(weekFromRanges(loadedHours));
      setOverrides(loadedOverrides);
      setBlocks(calendarDays.blocks);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, business.timeZone, resource, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditingRange(null);
      setEditingOverride(null);
      setEditingBlock(null);
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The week as edited, in place of the week that was there.
   *
   * Replacing rather than reconciling: the editor speaks in days, the store
   * speaks in ranges, and there is no correspondence between the two to
   * preserve — a day that lost its break has one range where it had two.
   */
  const saveWeek = async () => {
    if (resource === null || hours === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.replaceWorkingHours(
        token,
        business.id,
        resource.id,
        week.flatMap((day, dayOfWeek) => rangesFor(day, dayOfWeek)),
      );
      await load();
      setSaved(true);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (hours === null || resource === null) return <Spinner />;

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      {resources.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {resources.map((candidate) => (
            <button
              key={candidate.id}
              className="chip"
              onClick={() => setResource(candidate)}
              aria-pressed={candidate.id === resource.id}
              style={{
                background: candidate.id === resource.id ? "var(--accent)" : "var(--raised)",
                color: candidate.id === resource.id ? "var(--on-accent)" : "var(--ink)",
                border: `1px solid ${candidate.id === resource.id ? "var(--accent)" : "var(--line)"}`,
              }}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        {(["hours", "overrides", "blocks"] as const).map((candidate) => (
          <button
            key={candidate}
            className="chip"
            onClick={() => setLayer(candidate)}
            aria-pressed={layer === candidate}
            style={{
              flex: 1,
              background: layer === candidate ? "var(--accent-soft)" : "transparent",
              color: layer === candidate ? "var(--accent-strong)" : "var(--muted)",
              border: `1px solid ${layer === candidate ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {candidate === "hours" ? copy.tabHours : candidate === "overrides" ? copy.tabOverrides : copy.tabBlocks}
          </button>
        ))}
      </div>

      {error !== null && <Critical>{error}</Critical>}

      {layer === "hours" && (
        <>
          {/* The same editor the wizard uses. A business described its week
              once in plain words and then edited it, ever after, as a list of
              ranges with an add and a delete — the same week in two different
              languages, the second one ADR 0002's storage rather than anybody's
              idea of a Tuesday. */}
          {/* Keyed on the calendar: the editor holds which days the owner has
              pulled out of the usual, and that answer belongs to the week in
              front of them, not to the next calendar they switch to. */}
          <WeeklyHours key={resource.id} hours={week} setHours={setWeek} />
          {saved && (
            <p className="hint" role="status" style={{ margin: 0 }}>
              {copy.settingsSaved}
            </p>
          )}
          {/* A half-typed time is not a shorter day: saving it would drop the
              stretch it belongs to without saying so. */}
          {!weekIsUsable(week) && <p className="warn" style={{ margin: 0 }}>{copy.fixTheHours}</p>}
          <Button busy={busy} disabled={!weekIsUsable(week)} onClick={() => void saveWeek()}>
            {copy.save}
          </Button>
        </>
      )}

      {layer === "overrides" && (
        <>
          {/* ADR 0002: an override replaces the weekday's rules entirely. */}
          <Note>{copy.overrideNote}</Note>
          {overrides.length === 0 && <Empty title={copy.noHoursYet} />}
          {overrides.map((override) => (
            <Card key={override.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{formatLocalDate(override.date, language)}</span>
                <span className="hint">
                  {override.closed
                    ? copy.closedAllDay
                    : override.ranges.map((r) => `${r.start}–${r.end}`).join(", ")}
                </span>
              </span>
              <button
                onClick={() => act(() => api.deleteOverride(token, business.id, override.id))}
                style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}
              >
                {copy.delete}
              </button>
            </Card>
          ))}
          <Button
            intent="quiet"
            onClick={() =>
              setEditingOverride({
                date: todayIn(business.timeZone),
                closed: true,
                ranges: [{ start: "10:00", end: "14:00" }],
              })
            }
          >
            {copy.addOverride}
          </Button>
        </>
      )}

      {layer === "blocks" && (
        <>
          <Note>{copy.blockNote}</Note>
          {blocks.length === 0 && <Empty title={copy.noBlocks} body={copy.blockFormHint} />}
          {blocks.map((block) => (
            <Card key={block.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{block.reason || copy.reason}</span>
                <span className="hint tab">
                  {timeIn(block.startAt, business.timeZone, language)}–{timeIn(block.endAt, business.timeZone, language)}
                </span>
              </span>
              <button
                onClick={() => act(() => api.deleteBlock(token, business.id, block.id))}
                style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}
              >
                {copy.delete}
              </button>
            </Card>
          ))}
          <Button
            intent="quiet"
            onClick={() =>
              setEditingBlock({
                from: todayIn(business.timeZone),
                to: todayIn(business.timeZone),
                allDay: false,
                ranges: [{ start: "12:00", end: "13:00" }],
                reason: "",
              })
            }
          >
            {copy.addBlock}
          </Button>
        </>
      )}

      {/* --- Forms ---------------------------------------------------------- */}

      <Sheet open={editingRange !== null} onClose={() => setEditingRange(null)}>
        {editingRange !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{editingRange.id === null ? copy.newRange : copy.editRange}</h2>
            <Note>{copy.rangeHint}</Note>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field id="range-from" label={copy.from} type="time" value={editingRange.start}
                onChange={(e) => setEditingRange({ ...editingRange, start: e.target.value })} />
              <Field id="range-to" label={copy.to} type="time" value={editingRange.end}
                onChange={(e) => setEditingRange({ ...editingRange, end: e.target.value })} />
            </div>
            {editingRange.end <= editingRange.start && <Critical>{copy.rangeInvalid}</Critical>}
            <Button
              busy={busy}
              disabled={editingRange.end <= editingRange.start}
              onClick={() =>
                act(() =>
                  editingRange.id === null
                    ? api.addWorkingHours(token, business.id, resource.id, {
                        dayOfWeek: editingRange.dayOfWeek,
                        start: editingRange.start,
                        end: editingRange.end,
                      })
                    : api.updateWorkingHours(token, business.id, editingRange.id, {
                        start: editingRange.start,
                        end: editingRange.end,
                      }),
                )
              }
            >
              {copy.save}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={editingOverride !== null} onClose={() => setEditingOverride(null)}>
        {editingOverride !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{copy.addOverride}</h2>
            <Note>{copy.overrideFormHint}</Note>
            <Field id="override-date" label={copy.date} type="date" value={editingOverride.date}
              onChange={(e) => setEditingOverride({ ...editingOverride, date: e.target.value })} />
            <span className="label">{copy.whatHappens}</span>
            <div style={{ display: "flex", gap: 8 }}>
              {[true, false].map((closed) => (
                <button
                  key={String(closed)}
                  className="chip"
                  onClick={() => setEditingOverride({ ...editingOverride, closed })}
                  aria-pressed={editingOverride.closed === closed}
                  style={{
                    flex: 1,
                    background: editingOverride.closed === closed ? "var(--accent)" : "var(--raised)",
                    color: editingOverride.closed === closed ? "var(--on-accent)" : "var(--ink)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {closed ? copy.closedAllDay : copy.differentHours}
                </button>
              ))}
            </div>
            {!editingOverride.closed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* The same editor the week uses: a special day is a day, and a
                    day that shuts for lunch has two stretches whichever layer
                    it belongs to. */}
                <Stretches
                  id="override"
                  ranges={editingOverride.ranges}
                  setRanges={(ranges) => setEditingOverride({ ...editingOverride, ranges })}
                />
              </div>
            )}
            <Note>{copy.overrideReplaces}</Note>
            {!editingOverride.closed && !editingOverride.ranges.every(isUsable) && (
              <p className="warn" style={{ margin: 0 }}>{copy.fixTheHours}</p>
            )}
            <Button
              busy={busy}
              disabled={!editingOverride.closed && !editingOverride.ranges.every(isUsable)}
              onClick={() =>
                act(() =>
                  api.putOverride(token, business.id, resource.id, {
                    date: editingOverride.date,
                    note: null,
                    // An empty list is a day off — the absence of ranges is the
                    // whole of what "closed" means (ADR 0002). Merged on the
                    // way out, so two stretches the owner ran together are the
                    // one stretch they describe rather than a refusal.
                    ranges: editingOverride.closed
                      ? []
                      : mergedRanges(editingOverride.ranges),
                  }),
                )
              }
            >
              {copy.save}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={editingBlock !== null} onClose={() => setEditingBlock(null)}>
        {editingBlock !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{copy.addBlock}</h2>
            <Note>{copy.blockFormHint}</Note>
            {/* From and to, defaulting to the same day: a week away is one
                decision, and making it seven was the reason nobody made it. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field
                id="block-from-date"
                label={copy.fromDate}
                type="date"
                value={editingBlock.from}
                onChange={(e) =>
                  setEditingBlock({
                    ...editingBlock,
                    from: e.target.value,
                    // A range that ends before it starts is a slip, not an
                    // instruction: the far end follows the near one.
                    to: editingBlock.to < e.target.value ? e.target.value : editingBlock.to,
                  })
                }
              />
              <Field
                id="block-to-date"
                label={copy.toDate}
                type="date"
                value={editingBlock.to}
                onChange={(e) => setEditingBlock({ ...editingBlock, to: e.target.value })}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[true, false].map((allDay) => (
                <button
                  key={String(allDay)}
                  className="chip"
                  onClick={() => setEditingBlock({ ...editingBlock, allDay })}
                  aria-pressed={editingBlock.allDay === allDay}
                  style={{
                    flex: 1,
                    background: editingBlock.allDay === allDay ? "var(--accent)" : "var(--raised)",
                    color: editingBlock.allDay === allDay ? "var(--on-accent)" : "var(--ink)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {allDay ? copy.allDay : copy.partOfDay}
                </button>
              ))}
            </div>
            {!editingBlock.allDay && (
              <Stretches
                id="block"
                ranges={editingBlock.ranges}
                setRanges={(ranges) => setEditingBlock({ ...editingBlock, ranges })}
              />
            )}
            {!editingBlock.allDay && !editingBlock.ranges.every(isUsable) && (
              <p className="warn" style={{ margin: 0 }}>{copy.fixTheHours}</p>
            )}
            <Field id="block-reason" label={copy.reason} placeholder={copy.reasonPlaceholder} value={editingBlock.reason}
              problem={problem.text(editingBlock.reason, TEXT_RULES.reason)}
              onChange={(e) => setEditingBlock({ ...editingBlock, reason: e.target.value })} hint={copy.reasonHint} />
            <Button
              busy={busy}
              disabled={!editingBlock.allDay && !editingBlock.ranges.every(isUsable)}
              onClick={() =>
                act(() =>
                  api.createBlocks(
                    token,
                    business.id,
                    resource.id,
                    spansOf(editingBlock, business.timeZone),
                  ),
                )
              }
            >
              {copy.save}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

