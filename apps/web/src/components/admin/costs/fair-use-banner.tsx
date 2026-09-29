"use client";

import { useEffect, useState } from "react";
import { costApi } from "@/lib/api/cost-client.ts";
import type { FairUseAlertsDto } from "@/lib/api/cost-types.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * The only place Fair Use speaks up (ADR 0023): above the Businesses list, and
 * only while something is over. Worked out when the list opens; the × hides it
 * until the page is opened again, and nothing about that is kept.
 */
export const FairUseBanner = ({ token, onOpen }: { token: string; onOpen: () => void }) => {
  const words = useCopy("costs");
  const [alerts, setAlerts] = useState<FairUseAlertsDto | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    costApi
      .fairUseAlerts(token)
      .then((loaded) => live && setAlerts(loaded))
      // An alert that cannot be read is no reason to keep the list from showing.
      .catch(() => live && setAlerts(null));
    return () => {
      live = false;
    };
  }, [token]);

  if (hidden || alerts === null || (alerts.businessesOver === 0 && !alerts.signIn.over)) return null;

  return (
    <div className="fair-use-banner" role="status">
      <span className="body">
        <strong>{words.bannerTitle}</strong>
        {alerts.businessesOver > 0 && (
          <span>
            {fillText(alerts.businessesOver === 1 ? words.bannerOne : words.bannerBusinesses, {
              n: String(alerts.businessesOver),
              sources: alerts.sourcesOver.map((source) => words.source[source]).join(words.listJoin),
            })}
          </span>
        )}
        {alerts.signIn.over && (
          <span>{fillText(words.bannerSignIn, { n: String(alerts.signIn.today), limit: String(alerts.signIn.limit) })}</span>
        )}
        <span className="hint">{words.nothingStopped}</span>
        <button type="button" className="link" onClick={onOpen}>
          {words.toFairUse} ‹
        </button>
      </span>
      <button type="button" className="close" aria-label={words.hide} onClick={() => setHidden(true)}>
        ×
      </button>
    </div>
  );
};
