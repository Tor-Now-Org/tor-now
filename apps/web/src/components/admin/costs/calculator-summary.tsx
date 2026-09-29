"use client";

import type { CalculatorResult } from "@tor-now/domain";
import type { CalculatorUseDto, MessageSourceName } from "@/lib/api/cost-types.ts";
import { formatAgorot, formatCost, formatMargin, marginTone, MESSAGE_SOURCES, percentOf, withCount } from "@/lib/costs.ts";
import { formatRate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { CostSplit, ToneOfMargin } from "./cost-bits.tsx";

/**
 * What the calculator's numbers come to (ADR 0023): the full summary beside
 * the rows on a computer, and one line above them on a phone. Neither floats
 * over anything — the rows are what scroll.
 */

export const CalculatorSummary = ({ result, calendars, share }: {
  result: CalculatorResult;
  calendars: number;
  share: number | null;
}) => {
  const words = useCopy("costs");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const fitting = result.margins.filter((margin) => margin.fits);
  return (
    <div className="card calc-summary" aria-live="polite">
      <div className="total">
        <span className="hint">{words.costsUs}</span>
        <strong className="tab" data-total>
          {formatCost(result.total, language)}
        </strong>
      </div>
      {result.total > 0 && <CostSplit bySource={result.bySource} />}
      {result.smsMessages > 0 && (
        <span className="sms-share">
          {fillText(words.smsShare, {
            n: String(result.smsMessages),
            share: String(percentOf(result.smsCost, result.total)),
          })}
        </span>
      )}
      <div className="margins">
        {result.margins.map((margin) => (
          <div key={margin.plan} className={margin.fits ? "" : "off"} data-plan={margin.plan}>
            <strong>{billing.plan[margin.plan]}</strong>
            <span className="hint tab">{formatAgorot(margin.price, language)}</span>
            {margin.fits ? (
              <span className="m">
                <span className="hint">{words.margin}</span>
                <b className="tab" style={{ color: ToneOfMargin[marginTone(margin.margin)] }}>
                  {formatMargin(margin.margin, language)}
                </b>
              </span>
            ) : (
              <span className="m hint">{fillText(words.tooMany, { n: String(calendars), max: String(margin.allowance) })}</span>
            )}
          </div>
        ))}
      </div>
      {share !== null && fitting.length > 0 && (
        <div className="after-share stacked">
          <span>
            {fillText(words.afterShareLine, { share: formatCost(share, language) })}
          </span>
          <span className="plans">
            {fitting.map((margin) => (
              <span key={margin.plan}>
                {billing.plan[margin.plan]}{" "}
                <b className="tab" style={{ color: ToneOfMargin[marginTone(margin.marginAfterShare)] }}>
                  {formatMargin(margin.marginAfterShare, language)}
                </b>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
};

/** The phone's line above the rows: what it costs, and each fitting Plan's margin. */
export const CalculatorLine = ({ result }: { result: CalculatorResult }) => {
  const words = useCopy("costs");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  return (
    <div className="card calc-line" aria-hidden="true">
      <span className="t">
        <span className="hint">{words.costsUs}</span>
        <strong className="tab">{formatCost(result.total, language)}</strong>
      </span>
      {result.margins
        .filter((margin) => margin.fits)
        .map((margin) => (
          <span key={margin.plan} className="p">
            <span className="hint">{billing.plan[margin.plan]}</span>
            <strong className="tab" style={{ color: ToneOfMargin[marginTone(margin.margin)] }}>
              {formatMargin(margin.margin, language)}
            </strong>
          </span>
        ))}
    </div>
  );
};

/** Two ways to set one count: typed exactly, or dragged. They follow each other. */
const Meter = ({ id, label, rate, value, max, onChange }: {
  id: string;
  label: string;
  rate: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) => (
  <div className="calc-meter">
    <label htmlFor={id}>
      <bdi>{label}</bdi> <bdi className="hint tab">× {rate}</bdi>
    </label>
    <input
      id={id}
      className="field tab calc-num"
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      value={value}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (event.target.value !== "" && Number.isInteger(next) && next >= 0) onChange(next);
      }}
    />
    <input
      type="range"
      min={0}
      max={Math.max(max, value)}
      value={value}
      aria-label={`${label} · ${rate}`}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </div>
);

/** How far a slider reaches: well past a busy month, and past whatever is typed. */
const RANGE = { whatsapp: 2_000, sms: 60 } as const;

export const CalculatorRows = ({ use, result, rates, onChange }: {
  use: CalculatorUseDto;
  result: CalculatorResult;
  rates: { whatsapp: number | null; smsPart: number | null; partsPerSms: number };
  onChange: (use: CalculatorUseDto) => void;
}) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const perMessage = (micro: number | null) => (micro === null ? "—" : formatRate(micro, language));
  const perSms = rates.smsPart === null ? null : rates.smsPart * rates.partsPerSms;
  const smsRate =
    perSms === null ? "—" : `${formatCost(perSms, language)} · ${fillText(words.parts, { n: String(rates.partsPerSms) })}`;
  const row = (source: MessageSourceName, first: boolean) => (
    <div key={source} className={`cause${first ? " first" : ""}`} data-cause={source}>
      <div className="cause-head">
        <span>
          <strong>{words.source[source]}</strong>
          <span className="hint">{words.sourceWhat[source]}</span>
        </span>
        <b className="tab">{formatCost(result.bySource[source], language)}</b>
      </div>
      <Meter
        id={`calc-${source}-whatsapp`}
        label={words.whatsappMessages}
        rate={perMessage(rates.whatsapp)}
        value={use[source].whatsapp}
        max={RANGE.whatsapp}
        onChange={(value) => onChange(withCount(use, source, "whatsapp", value))}
      />
      <Meter
        id={`calc-${source}-sms`}
        label={words.smsMessages}
        rate={smsRate}
        value={use[source].sms}
        max={RANGE.sms}
        onChange={(value) => onChange(withCount(use, source, "sms", value))}
      />
    </div>
  );
  return (
    <div className="card calc-rows">
      {MESSAGE_SOURCES.map((source, at) => row(source, at === 0))}
      <div className="cause calendars">
        <label htmlFor="calc-calendars">
          {words.calendars} <span className="hint">— {words.calendarsHint}</span>
        </label>
        <input
          id="calc-calendars"
          className="field tab calc-num"
          type="number"
          min={1}
          max={100}
          step={1}
          value={use.calendars}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next) && next >= 1 && next <= 100) onChange({ ...use, calendars: next });
          }}
        />
      </div>
      <span className="hint rates-line">{words.ratesLine}</span>
    </div>
  );
};
