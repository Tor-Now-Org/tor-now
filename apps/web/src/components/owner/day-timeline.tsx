"use client";

import { useState } from "react";
import type { BusinessDayDto } from "@/lib/api/types.ts";
import { timeIn } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import {
  BOX_MINIMUM,
  FOLD_HEIGHT,
  WORDS_MINIMUM,
  bandsOf,
  clockOf,
  columnsOf,
  foldsIn,
  minutesOf,
  placeOf,
  scaleOf,
  spokenLength,
  swallowedBy,
  windowOf,
  type Band,
  type Span,
} from "./day-model.ts";

/**
 * A day as a timeline: what is in it, drawn against the hours it occupies.
 *
 * Four kinds of thing live on the same track and are told apart by three
 * channels rather than by colour alone — the shape says what kind it is, the
 * rail colour says which service, and a mark says whose calendar it is. That
 * leaves the whole thing readable with no colour at all, which matters more
 * than it sounds: an owner glances at this in a mirror-lit salon.
 *
 * Empty time folds, so a twelve-hour day fits on a phone, and a free stretch
 * too short for a box becomes a seam between its neighbours — because ten
 * minutes between two appointments genuinely is a seam. Every free stretch is
 * tappable: the emptiest part of the screen is the part an owner wants to fill.
 */

export type Picked =
  | { kind: "free"; start: number; end: number; resourceId: string; resourceName: string }
  | {
      kind: "appointment";
      id: string;
      start: number;
      end: number;
      resourceId: string;
      resourceName: string;
      customerName: string;
      customerPhone: string;
      serviceName: string;
    }
  | {
      kind: "block";
      id: string;
      groupId: string | null;
      start: number;
      end: number;
      resourceId: string;
      resourceName: string;
      reason: string;
    };

type Item = Span & { readonly entry: Picked };

/** Service colours, assigned by name so the same service keeps its hue all day. */
const HUES = ["var(--accent)", "var(--plum)", "var(--moss)", "var(--amber)"] as const;
const SOFT = [
  "var(--accent-soft)",
  "var(--plum-soft)",
  "var(--moss-soft)",
  "var(--amber-soft)",
] as const;

const hueOf = (services: readonly string[], name: string): number => {
  const at = services.indexOf(name);
  return at < 0 ? 0 : at % HUES.length;
};

/** A calendar's mark: the same initial and colour the month uses. */
const MARK = ["var(--accent)", "var(--plum)", "var(--moss)"] as const;

export const DayTimeline = ({
  day,
  timeZone,
  lanes,
  onPick,
}: {
  day: BusinessDayDto;
  timeZone: string;
  /** Which calendars to draw, in order. One of them is the ordinary case. */
  lanes: readonly { id: string; name: string }[];
  onPick: (picked: Picked) => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const [opened, setOpened] = useState<number[]>([]);

  const words = {
    hour: copy.oneHour,
    twoHours: copy.twoHours,
    hours: copy.manyHours,
    andHalf: copy.andHalf,
    minutes: copy.minutesShort,
  };

  const minutesIn = (iso: string) => minutesOf(timeIn(iso, timeZone, language));

  const services = [
    ...new Set(
      day.calendars.flatMap((calendar) =>
        calendar.appointments.map((appointment) => appointment.serviceName),
      ),
    ),
  ];

  const shown = lanes
    .map((lane) => day.calendars.find((calendar) => calendar.resourceId === lane.id))
    .filter((calendar): calendar is BusinessDayDto["calendars"][number] => calendar !== undefined);

  const itemsOf = (calendar: BusinessDayDto["calendars"][number]): Item[] => [
    ...calendar.appointments.map((appointment) => ({
      start: minutesIn(appointment.startAt),
      end: minutesIn(appointment.endAt),
      entry: {
        kind: "appointment" as const,
        id: appointment.id,
        start: minutesIn(appointment.startAt),
        end: minutesIn(appointment.endAt),
        resourceId: calendar.resourceId,
        resourceName: calendar.resourceName,
        customerName: appointment.customerName,
        customerPhone: appointment.customerPhone,
        serviceName: appointment.serviceName,
      },
    })),
    ...calendar.blocks.map((block) => ({
      start: minutesIn(block.startAt),
      end: minutesIn(block.endAt),
      entry: {
        kind: "block" as const,
        id: block.id,
        groupId: block.groupId ?? null,
        start: minutesIn(block.startAt),
        end: minutesIn(block.endAt),
        resourceId: calendar.resourceId,
        resourceName: calendar.resourceName,
        reason: block.reason,
      },
    })),
  ];

  const everything = shown.flatMap(itemsOf);
  const window = windowOf(
    shown.flatMap((calendar) => calendar.open),
    everything,
  );
  const folds = foldsIn(window, everything, opened);
  const scale = scaleOf(window, folds);

  const hours: number[] = [];
  for (let minute = window.start; minute <= window.end; minute += 60) hours.push(minute);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {shown.length > 1 && (
        <div style={{ display: "flex", gap: 5, paddingInlineStart: 46 }}>
          {shown.map((calendar, index) => (
            <span
              key={calendar.resourceId}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--muted)",
              }}
            >
              <Mark name={calendar.resourceName} index={index} />
              <span>{calendar.resourceName}</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: "relative", display: "flex", gap: 6, height: scale.height }}>
        {/* The rail, folding with the day: an hour a fold swallowed is not
            drawn, because the fold says which hours it holds. */}
        <div style={{ width: 40, flexShrink: 0, position: "relative" }}>
          {hours
            .filter((minute) => !swallowedBy(folds, minute))
            .map((minute) => (
              <span
                key={minute}
                className="tab"
                style={{
                  position: "absolute",
                  insetInlineEnd: 2,
                  top: scale.y(minute),
                  transform: "translateY(-50%)",
                  fontSize: 10,
                  color: "var(--faint)",
                  background: "var(--paper)",
                  padding: "0 2px",
                }}
              >
                {clockOf(minute)}
              </span>
            ))}
        </div>

        <div style={{ flex: 1, position: "relative", display: "flex", gap: 5 }}>
          {shown.map((calendar, laneIndex) => {
            const mine = itemsOf(calendar);
            const bands = bandsOf(window, mine);
            // Things happening at once share the width, so a day off and the
            // appointment inside it are both visible and both the right length.
            const columns = columnsOf(mine);
            return (
              <div
                key={calendar.resourceId}
                style={{
                  flex: 1,
                  minWidth: 0,
                  position: "relative",
                  background: "var(--raised)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                }}
              >
                {hours
                  .filter((minute) => !swallowedBy(folds, minute))
                  .map((minute) => (
                    <span
                      key={minute}
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        insetInline: 0,
                        top: scale.y(minute),
                        height: 1,
                        background: "var(--line)",
                        opacity: 0.55,
                      }}
                    />
                  ))}

                {bands.map((band, index) => {
                  if (folds.some((fold) => band.start >= fold.start && band.end <= fold.end)) {
                    return null;
                  }
                  const place = placeOf(bands, index, scale);
                  return band.kind === "free" ? (
                    <FreeSpace
                      key={`free-${band.start}`}
                      band={band}
                      place={place}
                      words={words}
                      label={copy.freeWord}
                      onClick={() =>
                        onPick({
                          kind: "free",
                          start: band.start,
                          end: band.end,
                          resourceId: calendar.resourceId,
                          resourceName: calendar.resourceName,
                        })
                      }
                    />
                  ) : (
                    <ItemBand
                      key={`item-${band.start}-${index}`}
                      band={band}
                      place={place}
                      column={columns.get(band.item) ?? { column: 0, columns: 1 }}
                      laneIndex={laneIndex}
                      laneName={calendar.resourceName}
                      services={services}
                      blockWord={copy.blockedWord}
                      onClick={() => onPick(band.item.entry)}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* A fold spans every lane, because that is what it means. */}
          {folds.map((fold) => (
            <button
              key={fold.start}
              onClick={() => setOpened([...opened, fold.start])}
              style={{
                position: "absolute",
                insetInline: 0,
                top: scale.y(fold.start),
                height: FOLD_HEIGHT - 3,
                borderRadius: 10,
                background: "var(--sunken)",
                border: "1px dashed var(--line)",
                color: "var(--muted)",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                zIndex: 3,
              }}
            >
              <span className="tab">
                {clockOf(fold.start)}–{clockOf(fold.end)}
              </span>
              <span>
                · {copy.freeWord} · {spokenLength(fold.end - fold.start, words)}
              </span>
              <span aria-hidden="true">▾</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const FreeSpace = ({
  band,
  place,
  words,
  label,
  onClick,
}: {
  band: Extract<Band<Item>, { kind: "free" }>;
  place: { top: number; height: number };
  words: Parameters<typeof spokenLength>[1];
  label: string;
  onClick: () => void;
}) => {
  const length = band.end - band.start;
  const said = `${label} · ${spokenLength(length, words)}`;

  // Too little room for a box: a seam between the two things either side, which
  // is what ten minutes between appointments actually is.
  if (place.height < BOX_MINIMUM) {
    return (
      <button
        onClick={onClick}
        aria-label={said}
        style={{
          position: "absolute",
          insetInline: 3,
          top: place.top + place.height / 2 - 7,
          height: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
        }}
      >
        <i style={{ flex: 1, height: 1, background: "var(--line)" }} />
        <u
          style={{
            width: 15,
            height: 15,
            borderRadius: 999,
            border: "1px dashed var(--line)",
            color: "var(--faint)",
            display: "grid",
            placeItems: "center",
            fontSize: 10,
            textDecoration: "none",
            background: "var(--paper)",
          }}
        >
          +
        </u>
        <i style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      aria-label={said}
      style={{
        position: "absolute",
        insetInline: 3,
        top: place.top + 1,
        height: place.height,
        borderRadius: 8,
        border: "1px dashed var(--line)",
        color: "var(--faint)",
        fontSize: place.height < WORDS_MINIMUM ? 9.5 : 10.5,
        background: "transparent",
      }}
    >
      {place.height < WORDS_MINIMUM ? `${length} ${words.minutes}` : said}
    </button>
  );
};

const ItemBand = ({
  band,
  place,
  column,
  laneIndex,
  laneName,
  services,
  blockWord,
  onClick,
}: {
  band: Extract<Band<Item>, { kind: "item" }>;
  place: { top: number; height: number };
  /** Which slice of the lane's width, when something else is happening too. */
  column: { column: number; columns: number };
  laneIndex: number;
  laneName: string;
  services: readonly string[];
  blockWord: string;
  onClick: () => void;
}) => {
  const entry = band.item.entry;
  // Two small lines need about this much; a half-hour appointment — the
  // commonest there is — clears it, and only genuinely short ones collapse to
  // the single line of time and name.
  const tight = place.height < 24;
  const appointment = entry.kind === "appointment";
  const hue = appointment ? hueOf(services, entry.serviceName) : 0;

  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        insetInlineStart: `calc(${(column.column / column.columns) * 100}% + 3px)`,
        width: `calc(${(1 / column.columns) * 100}% - 6px)`,
        top: place.top + 1,
        height: place.height,
        borderRadius: 8,
        padding: tight ? "1px 5px" : "3px 6px",
        overflow: "hidden",
        display: "flex",
        gap: 5,
        alignItems: tight ? "center" : "flex-start",
        textAlign: "start",
        lineHeight: 1.2,
        fontSize: 11,
        // Shape carries the kind, so none of this needs colour to be read.
        background: appointment
          ? SOFT[hue]
          : "repeating-linear-gradient(45deg,var(--sunken) 0 5px,oklch(91% 0.012 240) 5px 10px)",
        border: "1px solid var(--line)",
        borderInlineStart: `3px solid ${appointment ? HUES[hue] : "var(--faint)"}`,
        color: appointment ? "var(--ink)" : "var(--muted)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <b
          style={{
            fontWeight: 600,
            fontSize: 10.5,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {clockOf(band.start)}{" "}
          {entry.kind === "appointment"
            ? entry.customerName
            : entry.kind === "block"
              ? entry.reason || blockWord
              : blockWord}
        </b>
        {!tight && (
          <small
            style={{
              fontSize: 9.5,
              opacity: 0.85,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {entry.kind === "appointment" ? entry.serviceName : blockWord}
          </small>
        )}
      </span>
      {place.height >= 22 && column.columns === 1 && (
        <Mark name={laneName} index={laneIndex} />
      )}
    </button>
  );
};

/** Whose it is: the same initial, in the same colour, everywhere. */
const Mark = ({ name, index }: { name: string; index: number }) => (
  <span
    aria-hidden="true"
    style={{
      width: 18,
      height: 18,
      borderRadius: 999,
      flexShrink: 0,
      display: "grid",
      placeItems: "center",
      fontSize: 9.5,
      fontWeight: 600,
      fontFamily: "Rubik, sans-serif",
      background: MARK[index % MARK.length],
      color: "var(--on-accent)",
    }}
  >
    {name.slice(0, 1)}
  </span>
);
