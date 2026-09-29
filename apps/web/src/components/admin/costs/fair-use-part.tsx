"use client";

import { useEffect, useState } from "react";
import { costApi } from "@/lib/api/cost-client.ts";
import type { FairUseDto, FairUseSourceName, SourceFairUseDto } from "@/lib/api/cost-types.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { agorotOf, countOf, formatAgorot, formatCost, MICRO, shekelsText } from "@/lib/costs.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Field, Note, Sheet, Spinner } from "@/components/ui.tsx";

/**
 * Fair Use (ADR 0023): a limit per cause per Business, and one a day for
 * sign-in codes — each read against this month's usage whenever this opens.
 * Nothing about who is over is stored, and nothing is ever stopped.
 */

type Editing = { kind: "source"; source: FairUseSourceName } | { kind: "signIn" } | null;

export const FairUsePart = ({ token, onOpenBusiness }: { token: string; onOpenBusiness: (businessId: string) => void }) => {
  const words = useCopy("costs");
  const errorText = useErrorText();
  const [view, setView] = useState<FairUseDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [overOf, setOverOf] = useState<SourceFairUseDto | null>(null);

  useEffect(() => {
    costApi
      .fairUse(token)
      .then(setView)
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [token, errorText]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (view === null) return <Spinner />;

  return (
    <>
      <SignInCard view={view} onChange={() => setEditing({ kind: "signIn" })} />
      <Note>{words.fairUseNote}</Note>
      {view.sources.map((source) => (
        <LimitCard
          key={source.source}
          source={source}
          onChange={() => setEditing({ kind: "source", source: source.source })}
          onShowOver={() => setOverOf(source)}
        />
      ))}
      <span className="hint">{words.noLimitNote}</span>

      <LimitSheet
        key={editing === null ? "none" : editing.kind === "signIn" ? "signIn" : editing.source}
        token={token}
        view={view}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(next) => {
          setView(next);
          setEditing(null);
        }}
      />
      <OverSheet
        source={overOf}
        onClose={() => setOverOf(null)}
        onOpen={(businessId) => {
          setOverOf(null);
          onOpenBusiness(businessId);
        }}
      />
    </>
  );
};

const SignInCard = ({ view, onChange }: { view: FairUseDto; onChange: () => void }) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const { signIn } = view;
  return (
    <div className={`card limit-card${signIn.over ? " over" : ""}`} data-limit="SIGN_IN">
      <div className="head">
        <span className="what">
          <strong>{words.source.SIGN_IN}</strong>
          <span className="hint">{words.signInWhat}</span>
        </span>
        {signIn.over && <span className="over-tag">{words.overToday}</span>}
      </div>
      <div className="amount">
        <strong className="tab">{signIn.limit.toLocaleString(language)}</strong>
        <span className="hint">{words.codesPerDay}</span>
      </div>
      <div className="gauge" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (signIn.today / signIn.limit) * 100)}%` }} />
      </div>
      <span className="hint">
        {fillText(words.signInToday, {
          n: signIn.today.toLocaleString(language),
          cost: formatCost(signIn.cost, language),
          average: signIn.averagePerDay.toLocaleString(language),
        })}
      </span>
      <div className="foot">
        <button type="button" className="quiet" onClick={onChange}>
          {words.changeLimit}
        </button>
      </div>
    </div>
  );
};

const LimitCard = ({ source, onChange, onShowOver }: { source: SourceFairUseDto; onChange: () => void; onShowOver: () => void }) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const limitMicro = source.limit * MICRO.perAgora;
  const top = source.top;
  const over = top !== null && top.cost > limitMicro;
  return (
    <div className="card limit-card" data-limit={source.source}>
      <div className="head">
        <span className="what">
          <strong>{words.source[source.source]}</strong>
          <span className="hint">{words.sourceWhat[source.source]}</span>
        </span>
      </div>
      <div className="amount">
        <strong className="tab">{formatAgorot(source.limit, language)}</strong>
        <span className="hint">{words.perBusinessMonth}</span>
      </div>
      <div className={`gauge${over ? " over" : ""}`} aria-hidden="true">
        <span style={{ width: `${top === null ? 0 : Math.min(100, (top.cost / limitMicro) * 100)}%` }} />
      </div>
      <span className="hint">
        {top === null
          ? words.nobodySpent
          : fillText(words.topThisMonth, { cost: formatCost(top.cost, language), name: top.name }) +
            (over ? "" : fillText(words.limitTimes, { times: (limitMicro / top.cost).toFixed(1) }))}
      </span>
      <div className="foot">
        <button type="button" className="quiet" onClick={onChange}>
          {words.changeLimit}
        </button>
        {source.over.length === 0 ? (
          <span className="hint end">{words.nobodyOver}</span>
        ) : (
          <button type="button" className="link over end" onClick={onShowOver}>
            {source.over.length === 1 ? words.overOne : fillText(words.overCount, { n: String(source.over.length) })} ‹
          </button>
        )}
      </div>
    </div>
  );
};

const LimitSheet = ({
  token,
  view,
  editing,
  onClose,
  onSaved,
}: {
  token: string;
  view: FairUseDto;
  editing: Editing;
  onClose: () => void;
  onSaved: (view: FairUseDto) => void;
}) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const source = editing?.kind === "source" ? view.sources.find((one) => one.source === editing.source) : undefined;
  const [typed, setTyped] = useState(
    editing?.kind === "signIn" ? String(view.limits.signInPerDay) : source === undefined ? "" : shekelsText(source.limit),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing === null) return null;

  const value = editing.kind === "signIn" ? countOf(typed) : agorotOf(typed);
  const valid = value !== null && value >= 1;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        editing.kind === "signIn"
          ? await costApi.setSignInLimit(token, value)
          : await costApi.setBusinessLimit(token, editing.source, value),
      );
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const top = source?.top ?? null;
  return (
    <Sheet open onClose={onClose} labelledBy="limit-title">
      <form
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="limit-title" style={{ fontSize: 19 }}>
          {editing.kind === "signIn" ? words.signInLimitTitle : fillText(words.limitTitle, { source: words.source[editing.source] })}
        </h2>
        <Field
          id="limit-value"
          label={editing.kind === "signIn" ? words.signInField : words.limitField}
          hint={
            editing.kind === "signIn"
              ? fillText(words.signInHint, { n: String(view.signIn.today), average: String(view.signIn.averagePerDay) })
              : top === null
                ? words.nobodySpent
                : fillText(words.limitHint, { top: `${top.name}, ${formatCost(top.cost, language)}` })
          }
          inputMode={editing.kind === "signIn" ? "numeric" : "decimal"}
          dir="ltr"
          value={typed}
          problem={typed !== "" && !valid ? (editing.kind === "signIn" ? words.countProblem : words.limitProblem) : null}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Note>{words.limitApplies}</Note>
        {error !== null && <Critical>{error}</Critical>}
        <Button type="submit" busy={busy} disabled={!valid}>
          {words.save}
        </Button>
        <Button type="button" intent="quiet" onClick={onClose}>
          {words.cancel}
        </Button>
      </form>
    </Sheet>
  );
};

const OverSheet = ({
  source,
  onClose,
  onOpen,
}: {
  source: SourceFairUseDto | null;
  onClose: () => void;
  onOpen: (businessId: string) => void;
}) => {
  const words = useCopy("costs");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  if (source === null) return null;
  return (
    <Sheet open onClose={onClose} labelledBy="over-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="over-title" style={{ fontSize: 19 }}>
          {fillText(words.overTitle, { source: words.source[source.source] })}
        </h2>
        <Note>{words.overNote}</Note>
        <Card padded={false} style={{ padding: "4px 16px" }}>
          {source.over.map((business, at) => (
            <button
              key={business.businessId}
              type="button"
              className={`over-row${at === 0 ? " first" : ""}`}
              onClick={() => onOpen(business.businessId)}
            >
              <span className="what">
                <strong>{business.name}</strong>
                <span className="hint">
                  {fillText(words.overRow, {
                    plan: billing.plan[business.plan],
                    whatsapp: business.whatsapp.toLocaleString(language),
                    sms: business.smsMessages.toLocaleString(language),
                  })}
                </span>
              </span>
              <strong className="tab over-cost">{formatCost(business.cost, language)}</strong>
              <span className="hint tab">{fillText(words.ofLimit, { limit: formatAgorot(source.limit, language) })}</span>
              <span className="go" aria-hidden="true">
                ‹
              </span>
            </button>
          ))}
        </Card>
        <Button intent="quiet" onClick={onClose}>
          {words.close}
        </Button>
      </div>
    </Sheet>
  );
};
