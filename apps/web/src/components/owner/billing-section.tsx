"use client";

import type { BillingDto, ResourceDto } from "@/lib/api/types.ts";
import { PlanChooser } from "./plan-chooser.tsx";
import { daysUntil, deactivationDeadline, payTodayNote } from "@/lib/billing-alert.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillParts, fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Card, Note, Warning } from "@/components/ui.tsx";
import { NextDate, PlanBadge, StatusBadge } from "@/components/billing-badges.tsx";
import { IncludedFeatures } from "./included-features.tsx";
import { AddonsSection } from "./addons-section.tsx";
import { PaymentLines } from "@/components/payment-lines.tsx";
import { api } from "@/lib/api/client.ts";
import { paymentBoardOf } from "@/lib/next-payment.ts";
import { localDateOf } from "./day-filter.ts";
import { usePlans } from "@/lib/use-plans.ts";

/**
 * Above every tab, until paid: a lapsed Business is told when the nightly run
 * turns it off, one in its Grace Period or its Trial's last days when that
 * ends — each with the way to pay. A switched-off one never gets here — its
 * screen is a sheet saying so.
 */
export const PayTodayBanner = ({
  billing,
  timeZone,
  onPay,
}: {
  billing: BillingDto;
  timeZone: string;
  onPay: () => void;
}) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const note = payTodayNote(billing, billing.nextDate === null ? null : daysUntil(billing.nextDate, timeZone));
  if (note === null) return null;
  const longDate = (localDate: string) => formatLocalDate(localDate, language, { day: "numeric", month: "long" });
  const deadline = deactivationDeadline(timeZone);
  return (
    <div className="notice-banner-wrap">
      <Warning>
        {fillText(words[note], {
          date: note === "trialEndingNote" || note === "inGraceNote" ? longDate(billing.nextDate ?? "") : longDate(deadline.date),
          time: deadline.time,
        })}
      </Warning>
      <div className="notice-banner-actions">
        <button type="button" className="go" onClick={onPay}>
          {words.goToPayment}
        </button>
      </div>
    </div>
  );
};

/**
 * What the owner owes the platform, read-only (ADR 0016: the OWNER's alone).
 * The same status and date the administrator sees, said in the owner's words,
 * with the one sentence each status needs: a Trial says when it ends, grace
 * how long is left, a pending move when it lands.
 */
export const BillingSection = ({
  token,
  billing,
  timeZone,
  resources,
  onChanged,
}: {
  token: string;
  billing: BillingDto;
  timeZone: string;
  resources: readonly ResourceDto[];
  onChanged: (billing: BillingDto) => void;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("billing");
  const { language } = useLanguage();
  const { subscription, status, nextDate } = billing;
  const plans = usePlans();
  const longDate = (localDate: string) => formatLocalDate(localDate, language, { day: "numeric", month: "long" });
  const board = paymentBoardOf(billing);

  return (
    <>
      {status === "IN_GRACE" && nextDate !== null && (
        <Warning>
          {fillParts(copy.billingOverdue, { days: String(daysUntil(nextDate, timeZone)) }).map((part) => part.text)}
        </Warning>
      )}

      <Card style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        <Row label={copy.plan}>
          <PlanBadge plan={subscription.plan} />{" "}
          <span className="tab">{formatPrice(subscription.priceMinor, language, "—")}</span>{" "}
          <small className="hint">{words.perMonth}</small>
        </Row>
        <Row label={words.state}>
          <StatusBadge status={status} />
        </Row>
        <Row label={words.dateLabel[status]}>
          <NextDate status={status} date={nextDate} timeZone={timeZone} />
        </Row>
        {board !== null && <PaymentLines payment={board.nextPayment} />}
      </Card>

      {billing.features !== undefined && (
        <IncludedFeatures
          features={billing.features}
          addons={board?.addons ?? []}
          plans={plans}
          today={localDateOf(new Date().toISOString(), timeZone)}
        />
      )}

      {board !== null && (
        <AddonsSection
          board={board}
          onAdd={async (feature) => onChanged(await api.addMyAddon(token, subscription.businessId, feature))}
          onCancel={async (feature) => onChanged(await api.cancelMyAddon(token, subscription.businessId, feature))}
        />
      )}

      {status === "TRIAL" && nextDate !== null && (
        <Note>{fillText(words.trialNote, { date: longDate(nextDate) })}</Note>
      )}
      <PlanChooser
        key={`${subscription.plan}-${subscription.scheduledMove?.effectiveOn ?? ""}`}
        token={token}
        businessId={subscription.businessId}
        billing={billing}
        resources={resources}
        onChanged={onChanged}
      />

      <span className="label">{copy.recentPayments}</span>
      {billing.payments.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>{words.noPayments}</p>
      ) : (
        billing.payments.map((payment) => (
          <Card key={payment.id} style={{ display: "flex", gap: 10 }}>
            <span style={{ flex: 1 }}>{formatLocalDate(payment.paidOn, language)}</span>
            <span className="tab">{formatPrice(payment.amountMinor, language, "—")}</span>
          </Card>
        ))
      )}
      {/* The platform moves no money; a Payment records something that
          already happened elsewhere. */}
      <Note>{copy.billingNote}</Note>
    </>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 26 }}>
    <span className="label" style={{ flex: 1 }}>{label}</span>
    <span style={{ fontWeight: 500, fontSize: 14.5, display: "flex", gap: 6, alignItems: "center" }}>{children}</span>
  </div>
);
