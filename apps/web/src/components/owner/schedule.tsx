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
import { TEXT_RULES } from "@tor-now/domain";
import { useErrorText } from "@/lib/use-error-text.ts";
import { useFieldProblem } from "@/lib/use-field-problem.ts";
import { Button, Card, Critical, Empty, Field, Note, Sheet, Spinner } from "../ui.tsx";
import {
  emptyBulk,
  emptyWeek,
  rangesFor,
  weekFromRanges,
  WeeklyHours,
  type BulkHours,
  type DayHours,
} from "./weekly-hours.tsx";

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
  const [bulk, setBulk] = useState<BulkHours>(emptyBulk);
  const [saved, setSaved] = useState(false);
  const [overrides, setOverrides] = useState<OverrideDto[]>([]);
  const [blocks, setBlocks] = useState<BlockDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingRange, setEditingRange] = useState<{ id: string | null; dayOfWeek: number; start: string; end: string } | null>(null);
  const [editingOverride, setEditingOverride] = useState<{ date: string; closed: boolean; start: string; end: string } | null>(null);
  const [editingBlock, setEditingBlock] = useState<{ date: string; allDay: boolean; start: string; end: string; reason: string } | null>(null);

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
      for (const range of hours) {
        await api.deleteWorkingHours(token, business.id, range.id);
      }
      for (const [dayOfWeek, day] of week.entries()) {
        for (const range of rangesFor(day, dayOfWeek)) {
          await api.addWorkingHours(token, business.id, resource.id, range);
        }
      }
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
          <Note>{copy.hoursNote}</Note>
          <WeeklyHours hours={week} setHours={setWeek} bulk={bulk} setBulk={setBulk} />
          {saved && (
            <p className="hint" role="status" style={{ margin: 0 }}>
              {copy.settingsSaved}
            </p>
          )}
          <Button busy={busy} onClick={() => void saveWeek()}>
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
              setEditingOverride({ date: todayIn(business.timeZone), closed: true, start: "10:00", end: "14:00" })
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
              setEditingBlock({ date: todayIn(business.timeZone), allDay: false, start: "12:00", end: "13:00", reason: "" })
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field id="override-from" label={copy.from} type="time" value={editingOverride.start}
                  onChange={(e) => setEditingOverride({ ...editingOverride, start: e.target.value })} />
                <Field id="override-to" label={copy.to} type="time" value={editingOverride.end}
                  onChange={(e) => setEditingOverride({ ...editingOverride, end: e.target.value })} />
              </div>
            )}
            <Note>{copy.overrideReplaces}</Note>
            <Button
              busy={busy}
              onClick={() =>
                act(() =>
                  api.putOverride(token, business.id, resource.id, {
                    date: editingOverride.date,
                    note: null,
                    // An empty list is a day off — the absence of ranges is the
                    // whole of what "closed" means (ADR 0002).
                    ranges: editingOverride.closed
                      ? []
                      : [{ start: editingOverride.start, end: editingOverride.end }],
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
            <Field id="block-date" label={copy.date} type="date" value={editingBlock.date}
              onChange={(e) => setEditingBlock({ ...editingBlock, date: e.target.value })} />
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field id="block-from" label={copy.from} type="time" value={editingBlock.start}
                  onChange={(e) => setEditingBlock({ ...editingBlock, start: e.target.value })} />
                <Field id="block-to" label={copy.to} type="time" value={editingBlock.end}
                  onChange={(e) => setEditingBlock({ ...editingBlock, end: e.target.value })} />
              </div>
            )}
            <Field id="block-reason" label={copy.reason} placeholder={copy.reasonPlaceholder} value={editingBlock.reason}
              problem={problem.text(editingBlock.reason, TEXT_RULES.reason)}
              onChange={(e) => setEditingBlock({ ...editingBlock, reason: e.target.value })} hint={copy.reasonHint} />
            <Button
              busy={busy}
              onClick={() => {
                const start = editingBlock.allDay ? "00:00" : editingBlock.start;
                const end = editingBlock.allDay ? "23:59" : editingBlock.end;
                return act(() =>
                  api.createBlock(token, business.id, resource.id, {
                    startAt: localToInstant(editingBlock.date, start, business.timeZone),
                    endAt: localToInstant(editingBlock.date, end, business.timeZone),
                    reason: editingBlock.reason,
                  }),
                );
              }}
            >
              {copy.save}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

/**
 * A block is entered as a wall clock in the Business's own zone and stored as
 * an instant. The conversion is done here rather than by sending a naive string
 * the server would have to guess the zone of.
 */
const localToInstant = (date: string, time: string, timeZone: string): string => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetAt(asIfUtc, timeZone);
  return new Date(asIfUtc - offsetAt(asIfUtc - offset, timeZone)).toISOString();
};

const offsetAt = (instant: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"), read("second")) - instant;
};
