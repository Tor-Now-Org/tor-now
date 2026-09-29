"use client";

import { useEffect, useState } from "react";
import { costApi } from "@/lib/api/cost-client.ts";
import type { RunningCostAmountDto, RunningCostDto } from "@/lib/api/cost-types.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { agorotOf, formatAgorot, shekelsText } from "@/lib/costs.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { localDateOf } from "@/components/owner/day-filter.ts";
import { Button, Card, Critical, Field, Note, Sheet, Spinner, Warning } from "@/components/ui.tsx";

/**
 * Running costs (ADR 0023): what the platform pays every month whatever the
 * Businesses do, each amount dated and sourced like a Unit Rate. One sheet,
 * three views: the list, adding one, and a new amount for one.
 */

const PLATFORM_ZONE = "Asia/Jerusalem";

type View = { kind: "list" } | { kind: "add" } | { kind: "change"; cost: RunningCostDto };

/** The amount in force on a day: the latest that had started. */
export const amountOnDay = (cost: RunningCostDto, day: string): RunningCostAmountDto | null =>
  cost.amounts.filter((amount) => amount.effectiveFrom <= day).at(-1) ?? null;

export const RunningCostsSheet = ({
  open,
  token,
  onClose,
  onChanged,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const errorText = useErrorText();
  const [costs, setCosts] = useState<RunningCostDto[] | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setView({ kind: "list" });
    costApi
      .runningCosts(token)
      .then(setCosts)
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [open, token, errorText]);

  const saved = (next: RunningCostDto[]) => {
    setCosts(next);
    setView({ kind: "list" });
    onChanged();
  };

  return (
    <Sheet open={open} onClose={view.kind === "list" ? onClose : () => setView({ kind: "list" })} labelledBy="running-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error !== null && <Critical>{error}</Critical>}
        {costs === null ? (
          <Spinner />
        ) : view.kind === "list" ? (
          <RunningList costs={costs} onAdd={() => setView({ kind: "add" })} onChange={(cost) => setView({ kind: "change", cost })} onClose={onClose} />
        ) : (
          <AmountForm
            key={view.kind === "change" ? view.cost.id : "add"}
            token={token}
            cost={view.kind === "change" ? view.cost : null}
            names={costs.map((cost) => cost.name)}
            onSaved={saved}
            onCancel={() => setView({ kind: "list" })}
          />
        )}
      </div>
    </Sheet>
  );
};

const RunningList = ({
  costs,
  onAdd,
  onChange,
  onClose,
}: {
  costs: readonly RunningCostDto[];
  onAdd: () => void;
  onChange: (cost: RunningCostDto) => void;
  onClose: () => void;
}) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const today = localDateOf(new Date().toISOString(), PLATFORM_ZONE);
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric", year: "numeric" });

  return (
    <>
      <h2 id="running-title" style={{ fontSize: 19 }}>
        {words.runningTitle}
      </h2>
      <Note>{words.runningNote}</Note>
      {costs.length > 0 && (
        <Card padded={false} style={{ padding: "4px 16px" }}>
          {costs.map((cost, at) => {
            const now = amountOnDay(cost, today);
            const next = cost.amounts.find((amount) => amount.effectiveFrom > today);
            const status =
              now === null
                ? next === undefined
                  ? ""
                  : fillText(words.startsOn, { date: shortDate(next.effectiveFrom) })
                : now.amountMinor === 0
                  ? fillText(words.stoppedFrom, { date: shortDate(now.effectiveFrom) })
                  : fillText(words.runningSince, { date: shortDate(now.effectiveFrom), source: now.source });
            return (
              <div key={cost.id} className={`cost-row${at === 0 ? " first" : ""}`} data-running={cost.name}>
                <span className="what">
                  <span className="name">{cost.name}</span>
                  <span className="hint">{status}</span>
                </span>
                <strong className="tab">{now === null ? "—" : formatAgorot(now.amountMinor, language)}</strong>
                <button type="button" className="link" onClick={() => onChange(cost)}>
                  {words.change}
                </button>
              </div>
            );
          })}
        </Card>
      )}
      <Button onClick={onAdd}>{words.addRunning}</Button>
      <Button intent="quiet" onClick={onClose}>
        {words.close}
      </Button>
    </>
  );
};

/** A new cost with its first amount, or a new amount for one: never an edit of what was there. */
const AmountForm = ({
  token,
  cost,
  names,
  onSaved,
  onCancel,
}: {
  token: string;
  cost: RunningCostDto | null;
  names: readonly string[];
  onSaved: (costs: RunningCostDto[]) => void;
  onCancel: () => void;
}) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const today = localDateOf(new Date().toISOString(), PLATFORM_ZONE);
  const current = cost === null ? null : amountOnDay(cost, today);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(current === null ? "" : shekelsText(current.amountMinor));
  const [from, setFrom] = useState(cost === null ? `${today.slice(0, 7)}-01` : today);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minor = agorotOf(amount);
  const trimmedName = name.trim();
  const nameTaken = names.some((other) => other.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase());
  const nameOk = cost !== null || (trimmedName.length >= 2 && trimmedName.length <= 60 && !nameTaken);
  const sameDay = cost?.amounts.find((existing) => existing.effectiveFrom === from);
  const ready = nameOk && minor !== null && /^\d{4}-\d{2}-\d{2}$/.test(from) && source.trim().length >= 3;

  const save = async () => {
    if (minor === null) return;
    setBusy(true);
    setError(null);
    try {
      const amountInput = { amountMinor: minor, effectiveFrom: from, source: source.trim() };
      onSaved(
        cost === null
          ? await costApi.addRunningCost(token, { name: trimmedName, ...amountInput })
          : await costApi.setRunningCostAmount(token, cost.id, amountInput),
      );
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 id="running-title" style={{ fontSize: 19 }}>
        {cost === null ? words.addRunning : fillText(words.changeTitle, { name: cost.name })}
      </h2>
      {current !== null && (
        <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <span className="label" style={{ flex: 1 }}>
            {words.nowAmount}
          </span>
          <strong className="tab">{formatAgorot(current.amountMinor, language)}</strong>
        </Card>
      )}
      {cost === null && (
        <Field
          id="running-name"
          label={words.runningName}
          placeholder={words.runningNamePlaceholder}
          maxLength={60}
          value={name}
          problem={name !== "" && !nameOk ? words.runningNameProblem : null}
          onChange={(event) => setName(event.target.value)}
        />
      )}
      <Field
        id="running-amount"
        label={words.perMonth}
        hint={words.perMonthHint}
        inputMode="decimal"
        dir="ltr"
        value={amount}
        problem={amount !== "" && minor === null ? words.amountProblem : null}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Field id="running-from" type="date" label={words.from} value={from} onChange={(event) => setFrom(event.target.value)} />
      <Field
        id="running-source"
        label={words.sourceLabel}
        hint={words.sourceHint}
        placeholder={words.sourcePlaceholder}
        maxLength={500}
        value={source}
        onChange={(event) => setSource(event.target.value)}
      />
      {sameDay !== undefined && (
        <Warning>
          {fillText(words.replacesDay, { date: formatLocalDate(from, language, { day: "numeric", month: "numeric" }) })}
        </Warning>
      )}
      {error !== null && <Critical>{error}</Critical>}
      <Button busy={busy} disabled={!ready} onClick={() => void save()}>
        {cost === null ? words.add : words.save}
      </Button>
      <Button intent="quiet" onClick={onCancel}>
        {words.cancel}
      </Button>
    </>
  );
};
