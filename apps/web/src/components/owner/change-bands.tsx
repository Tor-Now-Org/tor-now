"use client";

import type { ChangeDto, ResourceDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { laneColourOf } from "./event-colour.ts";
import { markOf, rowOf } from "./change-model.ts";
import {
  DAYS_IN_A_WEEK,
  BAND_ROWS_IN_A_WEEK,
  labelFitting,
  mergeOverlapping,
  packBands,
  segmentIn,
  type Merged,
  type Segment,
} from "./month-model.ts";

/**
 * The strip every square keeps at its foot for the bands written across it.
 *
 * Fixed, and reserved whether or not there is anything to put in it, because a
 * month whose rows change height as things are added is a month that moves
 * under the finger. Two lines is what it holds; past that the week is counted
 * rather than grown.
 */
const BAND_HEIGHT = 12;
const BAND_GAP = 2;
/** How far the strip sits above the bottom edge of a square. */
const BAND_FOOT = 4;
export const BAND_AREA = BAND_HEIGHT * BAND_ROWS_IN_A_WEEK + BAND_GAP + BAND_FOOT;

const MARKS = ["CLOSED", "PART", "HOURS"] as const;

const indexOf = (calendars: readonly ResourceDto[], change: ChangeDto) =>
  change.scope.kind === "BUSINESS" ? -1 : calendars.findIndex((one) => one.id === (change.scope as { resourceId: string }).resourceId);

/** The changes a screen reading one calendar shows: the business's, and that calendar's own. */
export const changesFor = (changes: readonly ChangeDto[], scope: string | null): readonly ChangeDto[] =>
  scope === null
    ? changes
    : changes.filter((change) => change.scope.kind === "BUSINESS" || change.scope.resourceId === scope);

/**
 * A week's changes, as bars under the days they cover: one set of marks
 * everywhere, named by what happens. The whole business's are drawn dark across
 * every calendar; a calendar's own in that calendar's colour, one bar per
 * calendar per run of days.
 */
export const ChangeBands = ({
  week,
  row,
  changes,
  calendars,
  onOpen,
  onOpenWeek,
}: {
  week: readonly (string | null)[];
  row: number;
  changes: readonly ChangeDto[];
  calendars: readonly ResourceDto[];
  onOpen: (change: ChangeDto) => void;
  onOpenWeek: () => void;
}) => {
  const copy = useCopy("change");
  const owner = useCopy("owner");
  const many = calendars.length > 1;
  const inWeek = (list: readonly ChangeDto[]) =>
    list
      .map((change) => segmentIn(week, change))
      .filter((segment): segment is Segment<ChangeDto> => segment !== null);

  const business = inWeek(changes.filter((change) => change.scope.kind === "BUSINESS")).map((segment) => ({ ...segment, count: 1 }));
  // One bar per calendar per run of days saying the same thing: a chair away
  // three days running is one bar, but a day off beside a short day is two marks.
  const own = calendars.flatMap((calendar) =>
    MARKS.flatMap((mark) =>
      mergeOverlapping(
        inWeek(
          changes.filter(
            (change) =>
              change.scope.kind === "CALENDAR" && change.scope.resourceId === calendar.id && markOf(change) === mark,
          ),
        ),
      ),
    ),
  );
  const here: Merged<ChangeDto>[] = [...business, ...own];
  if (here.length === 0) return null;

  const packed = packBands(here);
  // The count needs the end of the last line to itself, or it would sit on top
  // of whatever band finishes the week.
  const crowded = packed.folded.length > 0;
  const rows = crowded
    ? packed.rows.map((line, at) => (at === packed.rows.length - 1 ? line.filter((one) => one.column > 0) : line))
    : packed.rows;
  const folded = packed.folded.length + packed.rows.flat().length - rows.flat().length;

  const labelOf = (change: ChangeDto, width: number) => {
    const mark = copy[`mark${markOf(change)}`];
    const named = change.scope.kind === "CALENDAR" ? (calendars[indexOf(calendars, change)]?.name ?? "") : "";
    return labelFitting(many && named !== "" ? [`${mark} (${named})`, mark] : [mark], width);
  };

  return (
    <div
      style={{
        position: "absolute",
        insetInline: 0,
        bottom: BAND_FOOT,
        display: "flex",
        flexDirection: "column",
        gap: BAND_GAP,
        pointerEvents: "none",
      }}
    >
      {rows.map((line, at) => (
        <div key={at} style={{ position: "relative", height: BAND_HEIGHT }}>
          {line.map(({ span, column, width, count }) => {
            const shop = span.scope.kind === "BUSINESS";
            const lane = laneColourOf(indexOf(calendars, span));
            return (
              <Band
                key={`${span.id}-${row}`}
                column={column}
                width={width}
                ground={shop ? "var(--closed)" : "var(--raised)"}
                ink={shop ? "var(--on-accent)" : "var(--ink)"}
                edge={shop ? "var(--closed)" : lane}
                dot={!shop && many ? lane : null}
                label={labelOf(span, width)}
                // One bar standing in for several changes cannot open any one
                // of them, so it opens the list of what is in the week.
                onClick={() => (count > 1 ? onOpenWeek() : onOpen(span))}
              />
            );
          })}
          {crowded && at === rows.length - 1 && (
            <button
              onClick={onOpenWeek}
              aria-label={owner.moreThatWeek.replace("{count}", String(folded))}
              style={{
                position: "absolute",
                insetInlineStart: 2,
                top: 0,
                height: BAND_HEIGHT,
                width: `calc(${(1 / DAYS_IN_A_WEEK) * 100}% - 4px)`,
                display: "grid",
                placeItems: "center",
                borderRadius: 999,
                background: "var(--raised)",
                border: "1px dashed var(--faint)",
                color: "var(--muted)",
                fontSize: 9,
                fontWeight: 600,
                pointerEvents: "auto",
              }}
            >
              {`+${folded}`}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

/** Every change in one week, as a list, for when the bars could not carry them all. */
export const WeekChanges = ({
  week,
  changes,
  calendars,
  onOpen,
}: {
  week: readonly (string | null)[];
  changes: readonly ChangeDto[];
  calendars: readonly ResourceDto[];
  onOpen: (change: ChangeDto) => void;
}) => {
  const copy = useCopy("change");
  const owner = useCopy("owner");
  const { language } = useLanguage();
  const inWeek = changes.filter((change) => segmentIn(week, change) !== null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: 18 }}>{owner.thatWeek}</h2>
      {inWeek.map((change) => {
        const row = rowOf(change, copy, language);
        const at = indexOf(calendars, change);
        return (
          <button key={change.id} className="change-row" onClick={() => onOpen(change)}>
            <i
              aria-hidden="true"
              style={{ width: 9, height: 9, borderRadius: 999, flexShrink: 0, background: at < 0 ? "var(--closed)" : laneColourOf(at) }}
            />
            <span className="what">
              <b>{change.note ?? row.what}</b>
              <small>
                {formatLocalDate(change.fromDate, language)}
                {change.toDate !== change.fromDate ? ` – ${formatLocalDate(change.toDate, language)}` : ""}
                {" · "}
                {at < 0 ? copy.wholeBusiness : (calendars[at]?.name ?? "")}
              </small>
            </span>
          </button>
        );
      })}
    </div>
  );
};

/** A change on the grid: a bar across the days it covers. */
const Band = ({
  column,
  width,
  label,
  dot,
  ground,
  ink,
  edge,
  onClick,
}: {
  column: number;
  width: number;
  label: string;
  dot: string | null;
  ground: string;
  ink: string;
  edge: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    style={{
      position: "absolute",
      insetInlineStart: `calc(${(column / DAYS_IN_A_WEEK) * 100}% + 2px)`,
      width: `calc(${(width / DAYS_IN_A_WEEK) * 100}% - 4px)`,
      height: BAND_HEIGHT,
      borderRadius: 999,
      background: ground,
      color: ink,
      border: `1px solid ${edge}`,
      fontSize: 9,
      fontWeight: 600,
      padding: "0 5px",
      display: "flex",
      alignItems: "center",
      gap: 4,
      whiteSpace: "nowrap",
      overflow: "hidden",
      pointerEvents: "auto",
    }}
  >
    {dot !== null && width > 1 && (
      <i aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: dot }} />
    )}
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
  </button>
);
