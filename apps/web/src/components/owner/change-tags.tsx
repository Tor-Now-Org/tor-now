"use client";

import type { ChangeDto, ResourceDto } from "@/lib/api/types.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { hoursText, markOf } from "./change-model.ts";

/**
 * The changes that reshape the day being read, as tags at its top: other hours
 * have nothing to hatch on the timeline — the day simply ends sooner — so they
 * say so in words. Hours taken off are hatched in the lanes and open from
 * there. A tag opens its change.
 */
export const ChangeTags = ({
  date,
  changes,
  lanes,
  calendars,
  onOpen,
}: {
  date: string;
  changes: readonly ChangeDto[];
  /** The calendars drawn on the timeline right now. */
  lanes: readonly string[];
  calendars: readonly ResourceDto[];
  onOpen: (change: ChangeDto) => void;
}) => {
  const copy = useCopy("change");
  const shown = changes.filter(
    (change) =>
      change.outcome === "OTHER_HOURS" &&
      change.days.some((day) => day.date === date) &&
      (change.scope.kind === "BUSINESS" || lanes.includes(change.scope.resourceId)),
  );
  if (shown.length === 0) return null;
  const many = calendars.length > 1;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {shown.map((change) => {
        const hours = hoursText(change.days.find((day) => day.date === date)?.ranges ?? []);
        const business = change.scope.kind === "BUSINESS";
        const whose =
          !business && many
            ? (calendars.find((one) => one.id === (change.scope as { resourceId: string }).resourceId)?.name ?? null)
            : null;
        return (
          <button
            key={change.id}
            type="button"
            className={business ? "change-tag business" : "change-tag"}
            onClick={() => onOpen(change)}
          >
            {[fillText(copy.todayTag, { mark: copy[`mark${markOf(change)}`] }), whose, hours, change.note]
              .filter((part): part is string => part !== null && part !== "")
              .join(" · ")}
          </button>
        );
      })}
    </div>
  );
};
