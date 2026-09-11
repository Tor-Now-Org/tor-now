"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ResourceDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Note, Sheet } from "../ui.tsx";
import { clockOf, spokenLength, withoutSpan } from "./day-model.ts";
import type { Picked } from "./day-timeline.tsx";

/**
 * What a tap on the timeline opens.
 *
 * The rule the whole screen rests on is that a tap only ever opens — nothing on
 * a surface people scroll past changes the day by itself. So this sheet is
 * where every change lives, and it offers only what the moment allows: ten
 * minutes cannot hold the shortest service and says so, and an hour that has
 * already gone is not worth blocking.
 *
 * A blockage that belongs to a longer one says which day of how many it is, and
 * offers both ways out by name rather than making the owner guess which button
 * takes the holiday with it.
 */

/** Nothing shorter than this can hold an appointment, whatever the service. */
const SHORTEST_SERVICE_MINUTES = 15;

export const DayActionSheet = ({
  picked,
  token,
  business,
  date,
  resources,
  openHours,
  onClose,
  onChanged,
}: {
  picked: Picked | null;
  token: string;
  business: BusinessDto;
  date: string;
  resources: readonly ResourceDto[];
  /** What each calendar keeps that day, so closing an hour keeps the rest. */
  openHours: Readonly<Record<string, readonly { start: string; end: string }[]>>;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const copy = useCopy("owner");
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<number | null>(null);

  const words = {
    hour: copy.oneHour,
    twoHours: copy.twoHours,
    hours: copy.manyHours,
    andHalf: copy.andHalf,
    minutes: copy.minutesShort,
  };

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setGroup(null);
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  /** How many days the blockage under the finger covers, once it is known. */
  const openBlock = async (groupId: string) => {
    try {
      const blocks = await api.blockGroup(token, business.id, groupId);
      setGroup(blocks.length);
    } catch {
      setGroup(1);
    }
  };

  return (
    <Sheet
      open={picked !== null}
      onClose={() => {
        setGroup(null);
        setError(null);
        onClose();
      }}
    >
      {picked !== null && picked.kind === "free" && (
        <FreeActions
          picked={picked}
          words={words}
          copy={copy}
          busy={busy}
          error={error}
          onBlock={() =>
            void act(() =>
              api.createBlocks(token, business.id, picked.resourceId, [
                {
                  startAt: instantOf(date, picked.start, business.timeZone),
                  endAt: instantOf(date, picked.end, business.timeZone),
                  reason: copy.blockedWord,
                },
              ]),
            )
          }
          onCloseShop={() =>
            void act(async () => {
              // The shop keeping other hours that day is a special day for
              // every calendar — the hours either side of what was tapped.
              for (const resource of resources) {
                await api.putOverride(token, business.id, resource.id, {
                  date,
                  note: null,
                  ranges: withoutSpan(openHours[resource.id] ?? [], picked),
                });
              }
            })
          }
        />
      )}

      {picked !== null && picked.kind === "block" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{picked.reason || copy.blockedWord}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {clockOf(picked.start)}–{clockOf(picked.end)} · {picked.resourceName}
          </p>

          {picked.groupId !== null && group === null && (
            <Button intent="quiet" onClick={() => void openBlock(picked.groupId ?? "")}>
              {copy.whatHappens}
            </Button>
          )}
          {group !== null && group > 1 && (
            <p className="said" style={{ margin: 0 }}>
              {copy.partOfBlockage.replace("{days}", String(group))}
            </p>
          )}

          {error !== null && <Critical>{error}</Critical>}

          <Button
            intent="danger"
            busy={busy}
            onClick={() => void act(() => api.deleteBlock(token, business.id, picked.id))}
          >
            {group !== null && group > 1 ? copy.removeThisDayOnly : copy.delete}
          </Button>
          {picked.groupId !== null && group !== null && group > 1 && (
            <Button
              intent="danger"
              busy={busy}
              onClick={() =>
                void act(() =>
                  api.deleteBlockGroup(token, business.id, picked.groupId ?? ""),
                )
              }
            >
              {copy.removeWholeBlockage.replace("{days}", String(group))}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
};

const FreeActions = ({
  picked,
  words,
  copy,
  busy,
  error,
  onBlock,
  onCloseShop,
}: {
  picked: Extract<Picked, { kind: "free" }>;
  words: Parameters<typeof spokenLength>[1];
  copy: ReturnType<typeof useCopy<"owner">>;
  busy: boolean;
  error: string | null;
  onBlock: () => void;
  onCloseShop: () => void;
}) => {
  const length = picked.end - picked.start;
  const tooShort = length < SHORTEST_SERVICE_MINUTES;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h2 style={{ flex: 1, fontSize: 18 }} className="tab">
          {clockOf(picked.start)}–{clockOf(picked.end)}
        </h2>
        <span className="badge">{spokenLength(length, words)}</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {picked.resourceName}
      </p>

      {/* Said rather than discovered: a gap too short for the shortest service
          cannot become an appointment, and the sheet explains instead of
          offering a button that would fail. */}
      {tooShort && (
        <Note>{copy.tooShortToBook.replace("{minutes}", String(SHORTEST_SERVICE_MINUTES))}</Note>
      )}

      {error !== null && <Critical>{error}</Critical>}

      <Button busy={busy} onClick={onBlock}>
        {copy.blockHere}
      </Button>
      <Button intent="quiet" busy={busy} onClick={onCloseShop}>
        {copy.closeShopHere}
      </Button>
    </div>
  );
};

/** A wall clock on this date, as the instant the API stores. */
const instantOf = (date: string, minutes: number, timeZone: string): string => {
  const clock = clockOf(minutes);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = clock.split(":").map(Number) as [number, number];
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetAt(asIfUtc, timeZone);
  return new Date(asIfUtc - offsetAt(asIfUtc - offset, timeZone)).toISOString();
};

const offsetAt = (instant: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (
    Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second"),
    ) - instant
  );
};
