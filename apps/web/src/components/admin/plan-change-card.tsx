"use client";

import { useState } from "react";
import type { BillingDto, PlanDto, PlanName } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Button, Card, Chip } from "@/components/ui.tsx";
import { outcomeOf } from "./plan-change.ts";

/**
 * Moving a Business to another Plan on its owner's behalf. The line under the
 * choice says when the move applies before the button is pressed, and the
 * button is named after what it will do.
 */
export const PlanChangeCard = ({
  billing,
  plans,
  busy,
  onMove,
}: {
  billing: BillingDto;
  plans: readonly PlanDto[];
  busy: boolean;
  onMove: (plan: PlanName) => void;
}) => {
  const copy = useCopy("admin");
  const words = useCopy("billing");
  const { language } = useLanguage();
  const current = billing.subscription;
  const [picked, setPicked] = useState<PlanName>(current.plan);
  const target = plans.find((plan) => plan.plan === picked);
  const outcome = target === undefined ? null : outcomeOf(current, target);
  const date = (localDate: string) => formatLocalDate(localDate, language, { day: "numeric", month: "long" });

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {current.scheduledMove !== null && (
        <div className="pending-move">
          <span>
            {fillText(copy.pendingMove, {
              plan: words.plan[current.scheduledMove.plan],
              date: date(current.scheduledMove.effectiveOn),
            })}
          </span>
          {/* Choosing the plan already held withdraws the move and nothing else. */}
          <button type="button" disabled={busy} onClick={() => onMove(current.plan)}>
            {copy.cancelMove}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {plans.map((plan) => (
          <Chip key={plan.plan} selected={picked === plan.plan} style={{ flex: 1 }} onClick={() => setPicked(plan.plan)}>
            {words.plan[plan.plan]}{" "}
            <small className="tab" style={{ opacity: 0.8 }}>{formatPrice(plan.priceMinor, language, "—")}</small>
          </Chip>
        ))}
      </div>

      {outcome !== null && target !== undefined && (
        <>
          <p className="hint" style={{ margin: 0 }}>
            {outcome.kind === "SAME"
              ? copy.samePlan
              : outcome.kind === "UPGRADE_NOW"
                ? fillText(copy.upgradeHint, { price: formatPrice(target.priceMinor, language, "—") })
                : outcome.kind === "DOWNGRADE_NOW"
                  ? copy.downgradeNowHint
                  : fillText(copy.downgradeHint, { date: date(outcome.on) })}
          </p>
          <Button intent="quiet" busy={busy} disabled={outcome.kind === "SAME"} onClick={() => onMove(target.plan)}>
            {fillText(outcome.kind === "DOWNGRADE_AT" ? copy.scheduleMove : copy.moveUpNow, {
              plan: words.plan[target.plan],
            })}
          </Button>
        </>
      )}
    </Card>
  );
};
