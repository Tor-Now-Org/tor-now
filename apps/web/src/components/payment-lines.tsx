"use client";

import type { PaymentBoardDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { monthlyTotal } from "@/lib/next-payment.ts";

/**
 * What a Business pays each month, under its Plan (ADR 0021): its Add-ons,
 * the total, and — when days are owed once — what the next payment comes to.
 * The owner's card and the administrator's say it the same way. Nothing when
 * there is nothing beyond the Plan to add up.
 */
export const PaymentLines = ({ payment }: { payment: PaymentBoardDto["nextPayment"] }) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const money = (minor: number) => formatPrice(minor, language, "—");
  const addons = payment.lines.flatMap((line) => (line.kind === "ADDON" ? [line] : []));
  const owedOnce = payment.lines.some((line) => line.kind === "DAYS");
  if (addons.length === 0 && !owedOnce) return null;

  const names = new Intl.ListFormat(language === "he" ? "he-IL" : "en-GB", { type: "conjunction" }).format(
    addons.map((line) => `${words.featureName[line.feature]} · ${money(line.amountMinor)}`),
  );
  return (
    <>
      {addons.length > 0 && (
        <div className="pay-row">
          <span className="label">{words.addons}</span>
          <span style={{ fontWeight: 500, fontSize: 14.5 }}>{names}</span>
        </div>
      )}
      <div className="pay-row total">
        <span className="label">{words.totalPerMonth}</span>
        <strong className="tab">{money(monthlyTotal(payment))}</strong>
      </div>
      {owedOnce && (
        <div className="pay-row">
          <span className="label">
            {fillText(words.nextPaymentOn, { date: formatLocalDate(payment.on, language, { day: "numeric", month: "numeric" }) })}
          </span>
          <strong className="tab">{money(payment.totalMinor)}</strong>
        </div>
      )}
    </>
  );
};
