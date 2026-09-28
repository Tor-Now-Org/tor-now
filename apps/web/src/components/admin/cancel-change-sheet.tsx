"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { PlanCatalogueDto, PlanViewDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Sheet } from "@/components/ui.tsx";
import { PlanBadge } from "@/components/billing-badges.tsx";
import { EffectBox } from "./plan-edit-sheet.tsx";

/** How many Businesses the sheet names before saying how many more. */
const SHOWN = 8;

/**
 * Who a pending change reaches, and cancelling it (ADR 0020): everyone back on
 * the edition before, as if it never was — and every one of them told.
 */
export const CancelChangeSheet = ({
  view,
  onClose,
  token,
  onCancelled,
}: {
  /** The Plan whose pending change is shown; null while the sheet is closed. */
  view: PlanViewDto | null;
  onClose: () => void;
  token: string;
  onCancelled: (catalogue: PlanCatalogueDto) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = view?.pending ?? null;
  if (view === null || pending === null) return null;

  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const people = [
    ...pending.moving.map((move) => ({ ...move.business, note: fillText(words.movesOn, { date: shortDate(move.effectiveOn) }) })),
    ...pending.joined.map((business) => ({ ...business, note: fillText(words.joinedEdition, { n: String(pending.edition.number) }) })),
  ];
  const everyone = people.length;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      onCancelled(await api.adminCancelPlanChange(token, view.plan));
      onClose();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} labelledBy="cancel-change-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="cancel-change-title" style={{ fontSize: 19 }}>
          {fillText(words.cancelTitle, { plan: billing.plan[view.plan] })}
        </h2>
        <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <PlanBadge plan={view.plan} version={pending.edition.number} />
          <span style={{ flex: 1, fontSize: 13.5 }}>
            {formatPrice(pending.edition.priceMinor, language, "—")} {billing.perMonth}
          </span>
          <span className="hint">
            {fillText(words.publishedOn, { date: shortDate(pending.edition.publishedAt.slice(0, 10)) })}
          </span>
        </Card>
        <span className="label">{fillText(words.inChange, { n: String(everyone) })}</span>
        <Card padded={false}>
          {people.slice(0, SHOWN).map((person) => (
            <div key={person.id} className="person-row">
              <span>{person.name}</span>
              <span className="hint">{person.note}</span>
            </div>
          ))}
          {everyone > SHOWN && (
            <div className="person-row hint">{fillText(words.andMore, { n: String(everyone - SHOWN) })}</div>
          )}
        </Card>
        {pending.cancellable && (
          <EffectBox
            tone="gives"
            title={words.cancelEffect}
            lines={[
              fillText(words.cancelStay, { n: String(pending.moving.length), previous: String(pending.previous.number) }),
              ...(pending.joined.length === 0
                ? []
                : [
                    fillText(words.cancelBack, {
                      n: String(pending.joined.length),
                      edition: String(pending.edition.number),
                      previous: String(pending.previous.number),
                    }),
                  ]),
              fillText(words.cancelNewJoin, { previous: String(pending.previous.number) }),
              words.cancelTold,
            ]}
          />
        )}
        {error !== null && <Critical>{error}</Critical>}
        {pending.cancellable && (
          <Button intent="danger" busy={busy} onClick={() => void cancel()}>
            {fillText(words.cancelDo, { n: String(everyone) })}
          </Button>
        )}
      </div>
    </Sheet>
  );
};
