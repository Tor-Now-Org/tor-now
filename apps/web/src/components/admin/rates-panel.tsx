"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { CostUnitName, UnitRateDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatRate, microShekelsOf, shekelsOf } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Field, Note, Sheet, Spinner, Warning } from "@/components/ui.tsx";
import { localDateOf } from "@/components/owner/day-filter.ts";
import { rateOnDay } from "@/lib/unit-rates.ts";

/**
 * What each unit of messaging costs the platform, and the evidence (ADR 0022).
 * A correction is a new figure from a day; nothing recorded is rewritten, and
 * everything used since that day is priced again when it is next read.
 */

const UNITS: readonly CostUnitName[] = ["WHATSAPP_UTILITY", "WHATSAPP_AUTHENTICATION", "SMS_SEGMENT"];
/** Rates are the platform's, so their day is Israel's. */
const PLATFORM_ZONE = "Asia/Jerusalem";

export const RatesPanel = ({ token }: { token: string }) => {
  const words = useCopy("catalogue");
  const errorText = useErrorText();
  const [rates, setRates] = useState<UnitRateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<CostUnitName | null>(null);
  const today = localDateOf(new Date().toISOString(), PLATFORM_ZONE);

  useEffect(() => {
    api
      .adminRates(token)
      .then(setRates)
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [token, errorText]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (rates === null) return <Spinner />;

  return (
    <>
      <Note>{words.ratesNote}</Note>
      {UNITS.map((unit) => (
        <RateCard key={unit} unit={unit} rates={rates} today={today} onCorrect={() => setCorrecting(unit)} />
      ))}
      <RateSheet
        key={correcting ?? "none"}
        unit={correcting}
        rates={rates}
        today={today}
        token={token}
        onClose={() => setCorrecting(null)}
        onSaved={setRates}
      />
    </>
  );
};

const RateCard = ({
  unit,
  rates,
  today,
  onCorrect,
}: {
  unit: CostUnitName;
  rates: readonly UnitRateDto[];
  today: string;
  onCorrect: () => void;
}) => {
  const words = useCopy("catalogue");
  const { language } = useLanguage();
  const [showHistory, setShowHistory] = useState(false);
  const current = rateOnDay(rates, unit, today);
  const history = rates
    .filter((rate) => rate.unit === unit && rate !== current)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const longDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "long", year: "numeric" });
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const per = unit === "SMS_SEGMENT" ? words.perSegmentFrom : words.perMessageFrom;
  const checkedTag = (rate: UnitRateDto) =>
    rate.checkedBy === null ? (
      <span className="rate-tag unchecked">{words.unchecked}</span>
    ) : (
      <span className="rate-tag checked">
        {fillText(words.checked, {
          name: rate.checkedBy,
          date: shortDate(localDateOf(rate.enteredAt, PLATFORM_ZONE)),
        })}
      </span>
    );

  return (
    <div className="card rate-card" style={{ padding: 16 }}>
      <div className="head">
        <span>
          <strong>{words.unit[unit]}</strong>
          <span className="hint">{words.unitWhat[unit]}</span>
        </span>
        {current !== null && checkedTag(current)}
      </div>
      {current === null ? (
        <span className="hint">{words.noRate}</span>
      ) : (
        <>
          <div className="price">
            <b dir="ltr">{formatRate(current.microShekels, language)}</b>
            <span className="hint">{fillText(per, { date: longDate(current.effectiveFrom) })}</span>
          </div>
          <span className="source">{fillText(words.sourceLine, { source: current.source })}</span>
        </>
      )}
      {showHistory && history.length > 0 && (
        <div className="rate-history">
          {history.map((rate) => (
            <div key={rate.effectiveFrom}>
              <b dir="ltr">{formatRate(rate.microShekels, language)}</b>
              <span>{fillText(per, { date: longDate(rate.effectiveFrom) })}</span>
              <span style={{ marginInlineStart: "auto" }}>{checkedTag(rate)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="foot">
        <button type="button" className="quiet" onClick={onCorrect}>
          {words.correct}
        </button>
        {history.length > 0 && (
          <button type="button" className="link" onClick={() => setShowHistory((shown) => !shown)}>
            {showHistory ? words.hideHistory : fillText(words.history, { n: String(history.length) })}
          </button>
        )}
      </div>
    </div>
  );
};

const RateSheet = ({
  unit,
  rates,
  today,
  token,
  onClose,
  onSaved,
}: {
  /** The unit being corrected; null while the sheet is closed. */
  unit: CostUnitName | null;
  rates: readonly UnitRateDto[];
  today: string;
  token: string;
  onClose: () => void;
  onSaved: (rates: UnitRateDto[]) => void;
}) => {
  const words = useCopy("catalogue");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const current = unit === null ? null : rateOnDay(rates, unit, today);
  const [price, setPrice] = useState(current === null ? "" : shekelsOf(current.microShekels));
  const [from, setFrom] = useState(today);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unit === null) return null;

  const micro = microShekelsOf(price);
  const inForceThen = rateOnDay(rates, unit, from);
  const sameDay = rates.find((rate) => rate.unit === unit && rate.effectiveFrom === from);
  const longDate = (date: string) => formatLocalDate(date, language);
  const ready = micro !== null && /^\d{4}-\d{2}-\d{2}$/.test(from) && source.trim().length >= 3;

  const save = async () => {
    if (micro === null) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.adminSetRate(token, { unit, effectiveFrom: from, microShekels: micro, source: source.trim() }));
      onClose();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} labelledBy="rate-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="rate-title" style={{ fontSize: 19 }}>
          {fillText(words.rateTitle, { unit: words.unit[unit] })}
        </h2>
        {current !== null && (
          <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
            <span className="label" style={{ flex: 1 }}>
              {words.now}
            </span>
            <strong dir="ltr" className="tab">
              {formatRate(current.microShekels, language)}
            </strong>
            <span className="hint">
              {formatLocalDate(current.effectiveFrom, language, { day: "numeric", month: "numeric" })}
              {current.checkedBy === null ? ` · ${words.unchecked}` : ""}
            </span>
          </Card>
        )}
        <Field
          id="rate-price"
          label={unit === "SMS_SEGMENT" ? words.pricePerSegment : words.pricePerMessage}
          hint={words.priceHint}
          problem={price !== "" && micro === null ? words.priceProblem : null}
          inputMode="decimal"
          dir="ltr"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <Field
          id="rate-from"
          type="date"
          label={words.from}
          hint={words.fromHint}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Field
          id="rate-source"
          label={words.source}
          hint={words.sourceHint}
          value={source}
          maxLength={500}
          onChange={(event) => setSource(event.target.value)}
        />
        {sameDay !== undefined ? (
          <Warning>{fillText(words.replaces, { date: longDate(from) })}</Warning>
        ) : (
          micro !== null &&
          inForceThen !== null &&
          from < today &&
          micro !== inForceThen.microShekels && (
            <Warning>
              {fillText(words.repriced, {
                date: longDate(from),
                new: formatRate(micro, language),
                old: formatRate(inForceThen.microShekels, language),
              })}
            </Warning>
          )
        )}
        {error !== null && <Critical>{error}</Critical>}
        <Button busy={busy} disabled={!ready} onClick={() => void save()}>
          {words.saveRate}
        </Button>
      </div>
    </Sheet>
  );
};
