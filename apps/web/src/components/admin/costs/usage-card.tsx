"use client";

import { useEffect, useState } from "react";
import { costApi } from "@/lib/api/cost-client.ts";
import type { BusinessUsageDto } from "@/lib/api/cost-types.ts";
import { formatAgorot, formatCost, MICRO } from "@/lib/costs.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { OverTag } from "./cost-bits.tsx";

/**
 * A Business's usage this month on its sheet (ADR 0023): each cause against
 * its Fair Use Limit, as of now. Read when the sheet opens; it says nothing
 * that is kept about the Business.
 */
export const UsageCard = ({ token, businessId }: { token: string; businessId: string }) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const [usage, setUsage] = useState<BusinessUsageDto | null>(null);

  useEffect(() => {
    let live = true;
    costApi
      .businessUsage(token, businessId)
      .then((loaded) => live && setUsage(loaded))
      // The rest of the sheet stands without it; a failed read shows nothing here.
      .catch(() => live && setUsage(null));
    return () => {
      live = false;
    };
  }, [token, businessId]);

  if (usage === null) return null;
  const over = usage.readings.some((reading) => reading.over);
  const paysLess = usage.total > usage.monthlyPriceMinor * MICRO.perAgora;

  return (
    <div className={`card usage-card${over ? " over" : ""}`} aria-label={words.usageTitle}>
      <div className="head">
        <span className="label">{words.usageTitle}</span>
        <span className="hint">{words.asOfNow}</span>
      </div>
      {usage.readings.map((reading) => {
        const share = Math.min(100, (reading.cost / (reading.limit * MICRO.perAgora)) * 100);
        return (
          <div key={reading.source} className={`reading${reading.over ? " over" : ""}`} data-reading={reading.source}>
            <div className="line">
              <span className="name">
                {words.source[reading.source]}
                {reading.over && <OverTag />}
              </span>
              <strong className="tab">{formatCost(reading.cost, language)}</strong>
              <span className="hint tab">{fillText(words.ofLimit, { limit: formatAgorot(reading.limit, language) })}</span>
            </div>
            <div className="gauge" aria-hidden="true">
              <span style={{ width: `${share}%` }} />
            </div>
          </div>
        );
      })}
      <span className="hint">
        {fillText(words.usageFooter, {
          whatsapp: usage.whatsapp.toLocaleString(language),
          sms: usage.smsMessages.toLocaleString(language),
          total: formatCost(usage.total, language),
        })}
        {paysLess && fillText(words.morethanPays, { price: formatAgorot(usage.monthlyPriceMinor, language) })}
      </span>
      {usage.unpricedUnits > 0 && <span className="hint">{fillText(words.unpricedUnits, { n: String(usage.unpricedUnits) })}</span>}
    </div>
  );
};
