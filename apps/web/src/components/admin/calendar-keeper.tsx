"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { AdminCalendarsDto } from "@/lib/api/types.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Warning } from "@/components/ui.tsx";
import { likelyToStay, tapped } from "./calendar-choice.ts";

/**
 * Settling a Business that holds more calendars than its plan allows — after a
 * move from Team to Solo, say (ADR 0019). The administrator chooses, with the
 * owner, which stay; one press pauses the rest. Nothing is drawn while the
 * Business is within its Allowance.
 */
export const CalendarKeeper = ({
  token,
  businessId,
  onSettled,
}: {
  token: string;
  businessId: string;
  onSettled: () => void;
}) => {
  const copy = useCopy("admin");
  const errorText = useErrorText();
  const [view, setView] = useState<AdminCalendarsDto | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await api.adminCalendars(token, businessId);
      const onOffer = loaded.calendars.filter((calendar) => calendar.paused !== true);
      setView(loaded);
      setChosen(likelyToStay(onOffer, loaded.resourceAllowance));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, businessId, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (view === null || view.overBy === 0) return null;

  const onOffer = view.calendars.filter((calendar) => calendar.paused !== true);
  const pausing = onOffer.length - chosen.length;
  const one = view.resourceAllowance === 1;

  const keep = async () => {
    setBusy(true);
    try {
      await api.adminKeepCalendars(token, businessId, chosen);
      await load();
      onSettled();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Warning>
        {fillText(one ? copy.overWarnOne : copy.overWarnMany, {
          n: String(onOffer.length),
          allowance: String(view.resourceAllowance),
        })}
      </Warning>
      <Card padded={false} role={one ? "radiogroup" : "group"} aria-label={copy.resources}>
        {onOffer.map((calendar, at) => {
          const stays = chosen.includes(calendar.id);
          return (
            <label
              key={calendar.id}
              className={`keep-row${stays ? " chosen" : ""}`}
              style={at > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
            >
              <input
                type={one ? "radio" : "checkbox"}
                name="calendar-stays"
                checked={stays}
                onChange={() => setChosen(tapped(chosen, calendar.id, view.resourceAllowance))}
              />
              <span className="name">
                {calendar.name}
                {stays && <span className="stays">{copy.stays}</span>}
              </span>
              <small className="tab">{fillText(copy.upcomingCount, { n: String(calendar.upcoming) })}</small>
            </label>
          );
        })}
      </Card>
      <Button busy={busy} disabled={chosen.length === 0 || pausing <= 0} onClick={() => void keep()}>
        {pausing === 1 ? copy.pauseOther : fillText(copy.pauseOthers, { n: String(pausing) })}
      </Button>
      <p className="hint" style={{ margin: 0 }}>{copy.pausedAfterNote}</p>
    </div>
  );
};
