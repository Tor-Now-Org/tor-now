"use client";

import { useEffect, useState } from "react";
import { costApi } from "@/lib/api/cost-client.ts";
import type { MonthCostsDto, PlanCostDto } from "@/lib/api/cost-types.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { formatAgorot, formatCost, formatMargin, marginTone } from "@/lib/costs.ts";
import { formatLocalDate, monthName } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { localDateOf } from "@/components/owner/day-filter.ts";
import { shiftMonth } from "@/components/owner/month-model.ts";
import { Card, Critical, Note, Spinner } from "@/components/ui.tsx";
import { CostRow, CostSplit, Figure, KindTag, OverTag, ToneOfMargin } from "./cost-bits.tsx";
import { RunningCostsSheet } from "./running-cost-sheets.tsx";

/**
 * "This month" (ADR 0023): what the platform cost that no Business caused, and
 * each Plan's four figures — worked out from the Usage Records when opened.
 */

const PLATFORM_ZONE = "Asia/Jerusalem";

export const MonthPart = ({
  token,
  onOpenBusiness,
  onShowRates,
}: {
  token: string;
  onOpenBusiness: (businessId: string) => void;
  onShowRates: () => void;
}) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const [month, setMonth] = useState<string | null>(null);
  const [figures, setFigures] = useState<MonthCostsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    costApi
      .month(token, month)
      .then((loaded) => live && setFigures(loaded))
      .catch((cause: unknown) => live && setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
    return () => {
      live = false;
    };
  }, [token, month, reload, errorText]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (figures === null) return <Spinner />;

  // The month asked for is shown at once; the figures below stay dimmed until
  // they are that month's, so a second tap never lands a month further than meant.
  const thisMonth = localDateOf(new Date().toISOString(), PLATFORM_ZONE).slice(0, 7);
  const shown = month ?? thisMonth;
  const loading = shown !== figures.month;
  const first = `${shown}-01`;
  const current = shown === thisMonth;
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });

  return (
    <>
      <div className="month-picker">
        <button type="button" className="chip tap" aria-label={words.previousMonth} onClick={() => setMonth(shiftMonth(first, -1).slice(0, 7))}>
          ‹
        </button>
        <span className="name">
          {monthName(first, PLATFORM_ZONE, language)}
          {current && <span className="hint"> · {words.soFar}</span>}
        </span>
        <button
          type="button"
          className="chip tap"
          aria-label={words.nextMonth}
          disabled={current}
          onClick={() => setMonth(shiftMonth(first, 1).slice(0, 7))}
        >
          ›
        </button>
      </div>

      <div className="month-figures" data-month={figures.month} aria-busy={loading}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-label={words.platformTitle}>
        <div className="card-title">
          <strong>{words.platformTitle}</strong>
          <span className="hint">{words.platformWhat}</span>
        </div>
        <div className="figure-pair">
          <Figure label={words.thisMonth} value={formatCost(figures.platform.total, language)} hint={words.everythingBelow} />
          <Figure
            label={words.perPaying}
            value={figures.platform.perPaying === null ? "—" : formatCost(figures.platform.perPaying, language)}
            hint={figures.paying === 0 ? words.noPaying : figures.paying === 1 ? words.sharedOverOne : fillText(words.sharedOver, { n: String(figures.paying) })}
          />
        </div>
        <div className="cost-rows">
          <CostRow
            first
            name={<>{words.source.SIGN_IN} <KindTag measured /></>}
            detail={fillText(words.signInDetail, { n: figures.platform.signIn.codes.toLocaleString(language) })}
            value={formatCost(figures.platform.signIn.cost, language)}
          />
          {figures.platform.running.map((line) => (
            <CostRow
              key={line.id}
              name={<>{line.name} <KindTag measured={false} /></>}
              detail={fillText(words.runningSince, { date: shortDate(line.since), source: line.source })}
              value={formatAgorot(line.amountMinor, language)}
            />
          ))}
        </div>
        {figures.platform.running.length === 0 && <span className="hint">{words.noRunning}</span>}
        <button type="button" className="quiet" onClick={() => setRunning(true)}>
          {words.runningCostsButton}
        </button>
      </Card>

      {figures.plans.map((plan) => (
        <PlanCostCard
          key={plan.plan}
          plan={plan}
          priceMinor={figures.prices.find((price) => price.plan === plan.plan)?.priceMinor ?? null}
          share={figures.platform.perPaying}
          overLimit={figures.overLimit}
          onOpenBusiness={onOpenBusiness}
        />
      ))}

      {(figures.trials.count > 0 || figures.notPaying.count > 0) && (
        <Card style={{ display: "flex", flexDirection: "column" }}>
          {figures.trials.count > 0 && (
            <CostRow
              first
              name={figures.trials.count === 1 ? words.trialsOne : fillText(words.trials, { n: String(figures.trials.count) })}
              value={formatCost(figures.trials.averageCost ?? 0, language)}
              trailing={<span className="hint">{words.onAverage}</span>}
            />
          )}
          {figures.notPaying.count > 0 && (
            <CostRow
              first={figures.trials.count === 0}
              name={figures.notPaying.count === 1 ? words.notPayingOne : fillText(words.notPaying, { n: String(figures.notPaying.count) })}
              value={formatCost(figures.notPaying.averageCost ?? 0, language)}
              trailing={<span className="hint">{words.onAverage}</span>}
            />
          )}
        </Card>
      )}

      {figures.unpriced.map((unpriced) => (
        <Note key={unpriced.unit}>
          {fillText(words.unpriced, {
            n: unpriced.messages.toLocaleString(language),
            unit: words.unitShort[unpriced.unit],
            date: shortDate(unpriced.from),
          })}{" "}
          <button type="button" className="link" onClick={onShowRates}>
            {words.toRates}
          </button>
        </Note>
      ))}

      </div>

      <RunningCostsSheet
        open={running}
        token={token}
        onClose={() => setRunning(false)}
        onChanged={() => setReload((count) => count + 1)}
      />
    </>
  );
};

const PlanCostCard = ({
  plan,
  priceMinor,
  share,
  overLimit,
  onOpenBusiness,
}: {
  plan: PlanCostDto;
  /** The current edition's price; null if the Plan has none on sale. */
  priceMinor: number | null;
  share: number | null;
  overLimit: readonly string[];
  onOpenBusiness: (businessId: string) => void;
}) => {
  const words = useCopy("costs");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const priciest = plan.priciest;

  return (
    <Card className="plan-cost" style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label={billing.plan[plan.plan]}>
      <div className="card-title">
        <strong>{billing.plan[plan.plan]}</strong>
        {priceMinor !== null && <span className="hint">{fillText(words.planPrice, { price: formatAgorot(priceMinor, language) })}</span>}
        <span className="hint end">{plan.paying === 1 ? words.payingOne : fillText(words.payingCount, { n: String(plan.paying) })}</span>
      </div>
      {plan.paying === 0 ? (
        <span className="hint">{words.nobodyPays}</span>
      ) : (
        <>
          <div className="figure-pair">
            <Figure
              label={words.averageCost}
              value={plan.averageCost === null ? "—" : formatCost(plan.averageCost, language)}
              hint={words.averageHint}
            />
            <Figure
              label={words.margin}
              value={formatMargin(plan.margin, language)}
              hint={words.marginHint}
              tone={ToneOfMargin[marginTone(plan.margin)]}
            />
          </div>
          {share !== null && (
            <div className="after-share">
              <span>
                {words.afterShare} <span className="hint tab">({formatCost(share, language)})</span>
              </span>
              <strong className="tab" style={{ color: ToneOfMargin[marginTone(plan.marginAfterShare)] }}>
                {formatMargin(plan.marginAfterShare, language)}
              </strong>
            </div>
          )}
          {plan.cost > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">{words.whatCosts}</span>
              <CostSplit bySource={plan.bySource} />
            </div>
          ) : (
            <span className="hint">{words.noCostYet}</span>
          )}
          {priciest !== null && (
            <button type="button" className="priciest" onClick={() => onOpenBusiness(priciest.businessId)}>
              <span className="what">
                <span className="hint">{words.priciest}</span>
                <span className="name">
                  <strong>{priciest.name}</strong>
                  {overLimit.includes(priciest.businessId) && <OverTag />}
                </span>
              </span>
              <strong className="tab">{formatCost(priciest.cost, language)}</strong>
              <span className="go" aria-hidden="true">‹</span>
            </button>
          )}
        </>
      )}
    </Card>
  );
};
