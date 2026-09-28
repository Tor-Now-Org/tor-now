"use client";

import { useState } from "react";
import { TEXT_RULES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import type { FeatureName, FeatureSourceDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { daysLeft, isGrantEnd } from "@/lib/grant-length.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSubmit } from "@/lib/use-submit.ts";
import { Button, Card, Critical, Field, Sheet } from "@/components/ui.tsx";
import { lastDayOf, LengthPicker, type Length } from "./length-picker.tsx";

/**
 * Giving a Business Features, and carrying one on (ADR 0021). Both ask the
 * same two things — until when, and why — so they share the length picker.
 */

/** Sends a change, and shows why it was refused rather than closing. */
const reasonOk = (reason: string) => reason.trim().length >= TEXT_RULES.auditReason.min;

export const GrantSheet = ({
  open,
  onClose,
  token,
  businessId,
  businessName,
  features,
  today,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  businessId: string;
  businessName: string;
  features: readonly FeatureSourceDto[];
  today: string;
  onGranted: (features: FeatureSourceDto[]) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const [chosen, setChosen] = useState<readonly FeatureName[]>([]);
  const [length, setLength] = useState<Length>({ kind: "days", days: 90 });
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit();
  const endsOn = lastDayOf(length, today);
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });

  const unavailable = (source: FeatureSourceDto): string | null => {
    switch (source.source) {
      case "PLAN":
        return words.inPlan;
      case "ADDON":
        return words.countAddon;
      case "PREVIEW":
        return words.inPreview;
      case "GRANT":
        return fillText(words.grantedUntil, { date: shortDate(source.endsOn ?? today) });
      case "NONE":
        return null;
    }
  };

  const toggle = (feature: FeatureName) =>
    setChosen((current) => (current.includes(feature) ? current.filter((f) => f !== feature) : [...current, feature]));

  const ready = chosen.length > 0 && isGrantEnd(today, endsOn) && reasonOk(reason);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="grant-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="grant-title" style={{ fontSize: 19 }}>
          {fillText(words.grantTitle, { name: businessName })}
        </h2>
        <span className="label">
          {words.which} <small className="hint">· {words.several}</small>
        </span>
        <Card padded={false} style={{ overflow: "hidden" }}>
          <div className="check-list">
            {features.map((source) => {
              const reasonNot = unavailable(source);
              const on = chosen.includes(source.feature);
              return (
                <label key={source.feature} className={`check-row${on ? " on" : ""}${reasonNot === null ? "" : " off"}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={reasonNot !== null}
                    onChange={() => toggle(source.feature)}
                  />
                  <span>{billing.featureName[source.feature]}</span>
                  {reasonNot !== null && <small>{reasonNot}</small>}
                </label>
              );
            })}
          </div>
        </Card>
        <LengthPicker
          id="grant-ends-on"
          label={words.until}
          length={length}
          from={today}
          onChange={setLength}
          hint={
            isGrantEnd(today, endsOn)
              ? fillText(words.endsOnHint, { date: formatLocalDate(endsOn, language) })
              : words.endsOnProblem
          }
        />
        <Field
          id="grant-reason"
          label={words.reason}
          hint={words.reasonHint}
          value={reason}
          maxLength={TEXT_RULES.auditReason.max}
          onChange={(event) => setReason(event.target.value)}
        />
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={!ready}
          onClick={() =>
            void submit(async () => {
              const result = await api.adminGrant(token, businessId, { features: [...chosen], endsOn, reason: reason.trim() });
              onGranted(result.features);
              setChosen([]);
              setReason("");
              onClose();
            })
          }
        >
          {chosen.length === 0
            ? words.chooseSome
            : chosen.length === 1
              ? words.grantOne
              : fillText(words.grantMany, { n: String(chosen.length) })}
        </Button>
      </div>
    </Sheet>
  );
};

export const ExtendSheet = ({
  source,
  onClose,
  token,
  businessId,
  today,
  onExtended,
}: {
  /** The Feature whose Grant is extended; null while the sheet is closed. */
  source: FeatureSourceDto | null;
  onClose: () => void;
  token: string;
  businessId: string;
  today: string;
  onExtended: (features: FeatureSourceDto[]) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const [length, setLength] = useState<Length>({ kind: "days", days: 30 });
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit();
  const current = source?.endsOn ?? today;
  const endsOn = lastDayOf(length, current);
  const valid = endsOn > current && isGrantEnd(today, endsOn);
  const longDate = (date: string) => formatLocalDate(date, language);

  return (
    <Sheet open={source !== null} onClose={onClose} labelledBy="extend-title">
      {source !== null && source.grant !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="extend-title" style={{ fontSize: 19 }}>
            {fillText(words.extendTitle, { feature: billing.featureName[source.feature] })}
          </h2>
          <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
            <span className="label" style={{ flex: 1 }}>
              {words.nowUntil}
            </span>
            <strong style={{ fontSize: 14.5 }}>{longDate(current)}</strong>
            <span className="hint">· {fillText(words.daysLeft, { n: String(daysLeft(today, current)) })}</span>
          </Card>
          <LengthPicker
            id="extend-ends-on"
            label={words.extendBy}
            length={length}
            from={current}
            onChange={setLength}
            hint={valid ? fillText(words.extendHint, { date: longDate(endsOn) }) : words.endsOnProblem}
          />
          <Field
            id="extend-reason"
            label={words.reason}
            hint={words.reasonHint}
            value={reason}
            maxLength={TEXT_RULES.auditReason.max}
            onChange={(event) => setReason(event.target.value)}
          />
          {error !== null && <Critical>{error}</Critical>}
          <Button
            busy={busy}
            disabled={!valid || !reasonOk(reason)}
            onClick={() =>
              void submit(async () => {
                const grantId = source.grant?.id;
                if (grantId === undefined) return;
                const result = await api.adminExtendGrant(token, businessId, grantId, { endsOn, reason: reason.trim() });
                onExtended(result.features);
                setReason("");
                onClose();
              })
            }
          >
            {fillText(words.extendTo, { date: longDate(endsOn) })}
          </Button>
        </div>
      )}
    </Sheet>
  );
};
