"use client";

import { useEffect, useMemo, useState } from "react";
import { calculate } from "@tor-now/domain";
import { costApi } from "@/lib/api/cost-client.ts";
import type { CalculatorBasisDto, CalculatorUseDto, ReferenceBusinessDto } from "@/lib/api/cost-types.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { calculatorInputs, sameUse } from "@/lib/costs.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Critical, Spinner, Warning } from "@/components/ui.tsx";
import { CalculatorLine, CalculatorRows, CalculatorSummary } from "./calculator-summary.tsx";
import { ManageSheet, MAX_SAVED, SaveNewSheet } from "./reference-sheets.tsx";

/**
 * The Cost Calculator (ADR 0023): the messages a Business sends in a month, in
 * the units a provider bills, and what they cost — worked out as the numbers
 * change, by the same function the API uses.
 */

type Measured = "actual" | "priciest";
type Selected = { kind: "measured"; id: Measured } | { kind: "saved"; id: string } | null;

const NOTHING: CalculatorUseDto = {
  calendars: 1,
  BOOKING: { whatsapp: 0, sms: 0 },
  REMINDERS: { whatsapp: 0, sms: 0 },
  WAITING_LIST: { whatsapp: 0, sms: 0 },
  BILLING: { whatsapp: 0, sms: 0 },
};

const measuredOf = (basis: CalculatorBasisDto, id: Measured) => (id === "actual" ? basis.actualAverage : basis.mostExpensive);

/** Where the numbers start: the actual average, else the first saved one, else nothing. */
const startingPoint = (basis: CalculatorBasisDto): { selected: Selected; use: CalculatorUseDto } => {
  if (basis.actualAverage !== null) return { selected: { kind: "measured", id: "actual" }, use: basis.actualAverage.use };
  const [first] = basis.saved;
  return first === undefined ? { selected: null, use: NOTHING } : { selected: { kind: "saved", id: first.id }, use: first.use };
};

export const CalculatorPart = ({ token }: { token: string }) => {
  const errorText = useErrorText();
  const [basis, setBasis] = useState<CalculatorBasisDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    costApi
      .calculator(token)
      .then(setBasis)
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [token, errorText]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (basis === null) return <Spinner />;
  return <Calculator token={token} basis={basis} />;
};

const Calculator = ({ token, basis }: { token: string; basis: CalculatorBasisDto }) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const start = useMemo(() => startingPoint(basis), [basis]);
  const [saved, setSaved] = useState<ReferenceBusinessDto[]>(basis.saved);
  const [selected, setSelected] = useState<Selected>(start.selected);
  const [use, setUse] = useState<CalculatorUseDto>(start.use);
  const [flash, setFlash] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"save" | "manage" | null>(null);

  const inputs = calculatorInputs(basis);
  const result = calculate({ use, ...inputs });
  const savedOne = selected?.kind === "saved" ? (saved.find((one) => one.id === selected.id) ?? null) : null;
  const baseline =
    selected === null ? NOTHING : selected.kind === "saved" ? (savedOne?.use ?? NOTHING) : (measuredOf(basis, selected.id)?.use ?? NOTHING);
  const dirty = !sameUse(use, baseline);

  const choose = (next: Selected, nextUse: CalculatorUseDto) => {
    setSelected(next);
    setUse(nextUse);
    setFlash(null);
  };

  const change = (next: CalculatorUseDto) => {
    setUse(next);
    setFlash(null);
  };

  const saveNew = async (name: string) => {
    const list = await costApi.saveReference(token, { name, use });
    const created = list.find((one) => one.name === name);
    setSaved(list);
    setSheet(null);
    if (created !== undefined) setSelected({ kind: "saved", id: created.id });
    setFlash(fillText(words.savedAs, { name }));
  };

  const update = async () => {
    if (savedOne === null) return;
    const list = await costApi.updateReference(token, savedOne.id, use);
    setSaved(list);
    setFlash(fillText(words.updated, { name: savedOne.name }));
  };

  const rename = async (id: string, name: string) => setSaved(await costApi.renameReference(token, id, name));

  const remove = async (id: string) => {
    const list = await costApi.deleteReference(token, id);
    setSaved(list);
    if (selected?.kind === "saved" && selected.id === id) {
      const next = startingPoint({ ...basis, saved: list });
      choose(next.selected, next.use);
    }
  };

  const note = (): string => {
    if (selected === null) return words.noMeasured;
    if (selected.kind === "saved") {
      return savedOne === null ? "" : fillText(words.noteSaved, { date: formatLocalDate(savedOne.savedOn, language, { day: "numeric", month: "numeric" }) });
    }
    const measured = measuredOf(basis, selected.id);
    return selected.id === "actual"
      ? measured?.over === 1
        ? words.noteActualOne
        : fillText(words.noteActual, { n: String(measured?.over ?? 0) })
      : fillText(words.notePriciest, { name: measured?.business?.name ?? "" });
  };

  const chip = (key: string, label: string, on: boolean, measured: boolean, onClick: () => void) => (
    <button key={key} type="button" className={`chip preset${measured ? " measured" : ""}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="calc-root">
      <div className="calc-presets">
        <div className="chips">
          {basis.actualAverage !== null &&
            chip("actual", words.presetActual, selected?.kind === "measured" && selected.id === "actual", true, () =>
              choose({ kind: "measured", id: "actual" }, basis.actualAverage?.use ?? NOTHING),
            )}
          {basis.mostExpensive !== null &&
            chip("priciest", words.presetPriciest, selected?.kind === "measured" && selected.id === "priciest", true, () =>
              choose({ kind: "measured", id: "priciest" }, basis.mostExpensive?.use ?? NOTHING),
            )}
          {(basis.actualAverage !== null || basis.mostExpensive !== null) && saved.length > 0 && <span className="divider" aria-hidden="true" />}
          {saved.map((one) =>
            chip(one.id, one.name, selected?.kind === "saved" && selected.id === one.id, false, () => choose({ kind: "saved", id: one.id }, one.use)),
          )}
          <button type="button" className="link manage" onClick={() => setSheet("manage")}>
            {words.manage}
          </button>
        </div>
        {flash !== null ? (
          <span className="hint flash" role="status">
            {flash}
          </span>
        ) : dirty ? (
          <div className="calc-changed">
            <span>
              {savedOne !== null
                ? fillText(words.changedIn, { name: savedOne.name })
                : selected?.kind === "measured"
                  ? `${fillText(words.changedIn, { name: selected.id === "actual" ? words.presetActual : words.presetPriciest })}${words.copyOnly}`
                  : words.changed}
            </span>
            <div className="row-actions">
              {savedOne !== null && (
                <button type="button" className="primary small" onClick={() => void update()}>
                  {fillText(words.update, { name: savedOne.name })}
                </button>
              )}
              <button
                type="button"
                className={`${savedOne !== null ? "quiet" : "primary"} small`}
                disabled={saved.length >= MAX_SAVED}
                onClick={() => setSheet("save")}
              >
                {words.saveNew}
              </button>
              <button type="button" className="link" onClick={() => choose(selected, baseline)}>
                {words.revert}
              </button>
            </div>
            {saved.length >= MAX_SAVED && <span className="hint">{words.full}</span>}
          </div>
        ) : (
          <span className="hint">{note()}</span>
        )}
      </div>

      {result.missingRates.map((unit) => (
        <Warning key={unit}>{fillText(words.missingRate, { unit: words.unitShort[unit] })}</Warning>
      ))}

      <CalculatorLine result={result} />
      <div className="calc-body">
        <CalculatorRows use={use} result={result} rates={basis.rates} onChange={change} />
        <div className="calc-side">
          <CalculatorSummary result={result} calendars={use.calendars} share={basis.share} />
        </div>
      </div>

      <SaveNewSheet open={sheet === "save"} saved={saved} onSave={saveNew} onClose={() => setSheet(null)} />
      <ManageSheet
        open={sheet === "manage"}
        basis={basis}
        saved={saved}
        onRename={rename}
        onDelete={remove}
        onClose={() => setSheet(null)}
      />
    </div>
  );
};
