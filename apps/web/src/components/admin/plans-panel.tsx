"use client";

import { useEffect, useState } from "react";
import { FEATURES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { PlanCatalogueDto, PlanName, PlanViewDto } from "@/lib/api/types.ts";
import { editionsInUse } from "@/lib/editions-table.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Critical, Note, Spinner } from "@/components/ui.tsx";
import { PlanBadge } from "@/components/billing-badges.tsx";
import { SourceMark } from "@/components/feature-source.tsx";
import { BILLING_ICONS } from "@/components/billing-icons.tsx";
import { CancelChangeSheet } from "./cancel-change-sheet.tsx";
import { EditionsSheet } from "./editions-sheet.tsx";
import { PlanEditSheet } from "./plan-edit-sheet.tsx";

/**
 * Every Plan as the Catalogue editor shows it (ADR 0020, ADR 0021): what it
 * costs and includes, the editions Businesses are on, a change waiting to
 * land — and from here, editing it, comparing its editions, or cancelling.
 */
export const PlansPanel = ({
  token,
  onShowBusinesses,
}: {
  token: string;
  /** Opens the Businesses list filtered to one edition. */
  onShowBusinesses: (editionId: string) => void;
}) => {
  const words = useCopy("catalogue");
  const errorText = useErrorText();
  const [catalogue, setCatalogue] = useState<PlanCatalogueDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanName | null>(null);
  const [cancelling, setCancelling] = useState<PlanName | null>(null);
  const [comparing, setComparing] = useState<PlanName | "ALL" | null>(null);

  useEffect(() => {
    api
      .adminPlans(token)
      .then(setCatalogue)
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  }, [token, errorText]);

  if (error !== null) return <Critical>{error}</Critical>;
  if (catalogue === null) return <Spinner />;

  const viewOf = (plan: PlanName | null) => catalogue.plans.find((view) => view.plan === plan) ?? null;
  const businesses = catalogue.plans.reduce(
    (sum, view) => sum + view.editions.reduce((inner, edition) => inner + edition.businesses, 0),
    0,
  );
  const show = (editionId: string) => {
    setComparing(null);
    onShowBusinesses(editionId);
  };

  return (
    <>
      <Note>{words.plansNote}</Note>
      <button type="button" className="card all-tiers" onClick={() => setComparing("ALL")}>
        <span className="source-mark preview" aria-hidden="true">
          {BILLING_ICONS.swap}
        </span>
        <span className="what">
          <strong>{words.allTiers}</strong>
          <span className="hint">
            {fillText(words.allTiersLine, {
              plans: String(catalogue.plans.length),
              editions: String(editionsInUse(catalogue.plans)),
              businesses: String(businesses),
            })}
          </span>
        </span>
        <span className="go">{words.open}</span>
      </button>

      {catalogue.plans.map((view) => (
        <PlanCard
          key={view.plan}
          view={view}
          previewing={catalogue.previews.map((preview) => preview.feature)}
          onEdit={() => setEditing(view.plan)}
          onCompare={() => setComparing(view.plan)}
          onCancel={() => setCancelling(view.plan)}
        />
      ))}

      <PlanEditSheet
        key={`edit-${editing ?? "none"}`}
        view={viewOf(editing)}
        previews={catalogue.previews}
        onClose={() => setEditing(null)}
        token={token}
        onSaved={setCatalogue}
      />
      <CancelChangeSheet
        key={`cancel-${cancelling ?? "none"}`}
        view={viewOf(cancelling)}
        onClose={() => setCancelling(null)}
        token={token}
        onCancelled={setCatalogue}
      />
      <EditionsSheet
        key={`compare-${comparing ?? "none"}`}
        open={comparing !== null}
        onClose={() => setComparing(null)}
        catalogue={catalogue}
        {...(comparing === null || comparing === "ALL" ? {} : { only: comparing })}
        onShowBusinesses={show}
      />
    </>
  );
};

const PlanCard = ({
  view,
  previewing,
  onEdit,
  onCompare,
  onCancel,
}: {
  view: PlanViewDto;
  previewing: readonly string[];
  onEdit: () => void;
  onCompare: () => void;
  onCancel: () => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const { current, pending } = view;
  const businesses = view.editions.reduce((sum, edition) => sum + edition.businesses, 0);
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const calendars =
    current.resourceAllowance === 1 ? billing.oneCalendar : fillText(billing.upToCalendars, { n: String(current.resourceAllowance) });
  const older = view.editions.filter((edition) => !edition.current);
  const leavingOn = (editionId: string) =>
    pending?.previous.id === editionId && pending.edition.firstMoveOn !== null ? pending.edition.firstMoveOn : null;

  return (
    <div className="card plan-card">
      <div className="top">
        <PlanBadge plan={view.plan} version={current.number} />
        <span className="hint">{fillText(words.businessesN, { n: String(businesses) })}</span>
      </div>
      <div className="price">
        <b dir="ltr">{formatPrice(current.priceMinor, language, "—")}</b>
        <span className="hint">{fillText(words.perMonthCalendars, { calendars })}</span>
      </div>
      <div>
        {FEATURES.map((feature) => {
          const included = current.features.includes(feature);
          return (
            <div key={feature} className={`feature-row compact ${included ? "plan" : "none"}`}>
              <SourceMark tone={included ? "plan" : "none"} />
              <span className="what">
                <strong>{billing.featureName[feature]}</strong>
              </span>
              {!included && previewing.includes(feature) && <span className="hint">{words.inPreviewNote}</span>}
            </div>
          );
        })}
      </div>

      {older.length > 0 && (
        <div className="editions-row">
          <span className="label">{words.editions}</span>
          <div className="chips">
            <span className="edition-chip on">
              <b>v{current.number}</b>
              {fillText(words.editionCurrent, { n: String(view.editions.find((e) => e.current)?.businesses ?? 0) })}
            </span>
            {older.map((edition) => {
              const leaving = leavingOn(edition.id);
              return (
                <span key={edition.id} className="edition-chip">
                  <b>v{edition.number}</b>
                  {leaving === null
                    ? fillText(words.editionOn, { n: String(edition.businesses) })
                    : fillText(words.editionLeaving, { n: String(edition.businesses), date: shortDate(leaving) })}
                </span>
              );
            })}
            <button type="button" className="link" onClick={onCompare}>
              {words.compare}
            </button>
          </div>
        </div>
      )}

      {pending !== null && pending.edition.firstMoveOn !== null && (
        <div className="pending-move pending-change">
          <span className="head">
            <PlanBadge plan={view.plan} version={pending.edition.number} />
            <strong>{fillText(words.pendingTitle, { price: formatPrice(pending.edition.priceMinor, language, "—") })}</strong>
          </span>
          <span className="body">
            {fillText(words.pendingBody, {
              n: String(pending.edition.number),
              since: shortDate(pending.edition.publishedAt.slice(0, 10)),
              moving: String(pending.moving.length),
              previous: String(pending.previous.number),
              first: shortDate(pending.edition.firstMoveOn),
            })}
            {pending.cancellable ? words.pendingCancellable : words.pendingStarted}
          </span>
          <span className="actions">
            <button type="button" onClick={onCancel}>
              {words.whoIsMoving}
            </button>
            {pending.cancellable && (
              <button type="button" className="end" onClick={onCancel}>
                {words.cancelChange}
              </button>
            )}
          </span>
        </div>
      )}

      <button type="button" className="quiet" onClick={onEdit}>
        {words.editPlan}
      </button>
    </div>
  );
};
