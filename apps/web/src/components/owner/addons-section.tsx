"use client";

import { useState } from "react";
import type { AddonDto, FeatureName, PaymentBoardDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { daysOf, lastPaidDay, totalAfterAdding, totalAfterCancelling } from "@/lib/next-payment.ts";
import { useSubmit } from "@/lib/use-submit.ts";
import { Button, Card, Critical, Sheet } from "@/components/ui.tsx";
import { BILLING_ICONS } from "@/components/billing-icons.tsx";
import { EffectBox } from "@/components/effect-box.tsx";

/**
 * Add-ons on the subscription page (ADR 0021): what is on sale to this
 * Business and what it holds, with adding, cancelling and taking a
 * cancellation back. The owner's own page, and the administrator's Business
 * sheet for an owner who phones in — the same rows, the same sheets.
 */

/** Adding or cancelling one; whoever shows the section takes the Business's new standing from it. */
type Act = (feature: FeatureName) => Promise<void>;

export const AddonsSection = ({ board, onAdd, onCancel }: { board: PaymentBoardDto; onAdd: Act; onCancel: Act }) => {
  const words = useCopy("billing");
  const [adding, setAdding] = useState<AddonDto | null>(null);
  const [cancelling, setCancelling] = useState<AddonDto | null>(null);
  const { busy, error, submit } = useSubmit();
  if (board.addons.length === 0) return null;

  const resume = (feature: FeatureName) => void submit(() => onAdd(feature));

  return (
    <>
      <span className="label">{words.addons}</span>
      <div className="card addons-card">
        {board.addons.map((addon) => (
          <AddonRow
            key={addon.feature}
            addon={addon}
            busy={busy}
            onAdd={() => setAdding(addon)}
            onCancel={() => setCancelling(addon)}
            onResume={() => resume(addon.feature)}
          />
        ))}
      </div>
      {error !== null && <Critical>{error}</Critical>}
      <p className="hint" style={{ margin: 0 }}>
        {words.addonsNote}
      </p>
      <AddSheet
        key={`add-${adding?.feature ?? ""}`}
        addon={adding}
        payment={board.nextPayment}
        onClose={() => setAdding(null)}
        onAdd={onAdd}
      />
      <CancelSheet
        key={`cancel-${cancelling?.feature ?? ""}`}
        addon={cancelling}
        payment={board.nextPayment}
        onClose={() => setCancelling(null)}
        onCancel={onCancel}
      />
    </>
  );
};

const AddonRow = ({
  addon,
  busy,
  onAdd,
  onCancel,
  onResume,
}: {
  addon: AddonDto;
  busy: boolean;
  onAdd: () => void;
  onCancel: () => void;
  onResume: () => void;
}) => {
  const words = useCopy("billing");
  // What each Feature does, in one line: the Catalogue's own description of it.
  const what = useCopy("catalogue");
  const { language } = useLanguage();
  const money = (minor: number) => formatPrice(minor, language, "—");
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const { holding } = addon;
  const cancelled = holding?.ending === "CANCELLED";

  const notes = [
    holding?.nextPrice === null || holding?.nextPrice === undefined
      ? null
      : fillText(words.addonRising, { date: shortDate(holding.nextPrice.effectiveOn), price: money(holding.nextPrice.priceMinor) }),
    holding !== null && !addon.onSale && !cancelled ? words.addonNotOnSale : null,
    holding !== null && addon.inTrialUntil !== null && !cancelled ? words.addonKeptAfterTrial : null,
    cancelled && holding?.endsOn !== null && holding?.endsOn !== undefined
      ? fillText(words.addonCancelledUntil, { date: shortDate(holding.endsOn) })
      : null,
    holding === null && addon.inTrialUntil !== null ? fillText(words.addonInTrial, { date: shortDate(addon.inTrialUntil) }) : null,
    holding === null && addon.inTrialUntil === null && addon.hadBefore ? words.addonHadBefore : null,
  ].filter((note): note is string => note !== null);

  return (
    <div className="addon-row">
      <span className="what">
        <strong>{words.featureName[addon.feature]}</strong>
        <span className="hint">{what.featureWhat[addon.feature]}</span>
        <span className="price tab">{fillText(words.addonPerMonth, { price: money(addon.priceMinor) })}</span>
        {notes.map((note) => (
          <span key={note} className="note-line">
            {note}
          </span>
        ))}
      </span>
      <span className="side">
        {holding !== null && !cancelled && (
          <>
            <span className="addon-active">{words.addonActive}</span>
            <button type="button" className="link-quiet" onClick={onCancel}>
              {words.addonCancel}
            </button>
          </>
        )}
        {cancelled && (
          <button type="button" className="chip addon-add" disabled={busy} onClick={onResume}>
            {words.addonUndo}
          </button>
        )}
        {holding === null && addon.ifAdded !== null && (
          <button type="button" className="chip addon-add" onClick={onAdd}>
            {BILLING_ICONS.plus}
            {addon.inTrialUntil === null ? words.addonAdd : words.addonKeepAfterTrial}
          </button>
        )}
      </span>
    </div>
  );
};

/** The new total, the old one struck through beside it. */
const NextTotal = ({ on, from, to }: { on: string; from: number; to: number }) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const money = (minor: number) => formatPrice(minor, language, "—");
  return (
    <Card style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 14px" }}>
      <span className="label" style={{ flex: 1 }}>
        {fillText(words.nextPaymentOn, { date: formatLocalDate(on, language, { day: "numeric", month: "numeric" }) })}
      </span>
      {from !== to && (
        <span className="tab" style={{ color: "var(--muted)", textDecoration: "line-through" }}>
          {money(from)}
        </span>
      )}
      <strong className="tab" style={{ fontSize: 15 }}>
        {money(to)}
      </strong>
    </Card>
  );
};

const AddSheet = ({
  addon,
  payment,
  onClose,
  onAdd,
}: {
  addon: AddonDto | null;
  payment: PaymentBoardDto["nextPayment"];
  onClose: () => void;
  onAdd: (feature: FeatureName) => Promise<void>;
}) => {
  const words = useCopy("billing");
  const what = useCopy("catalogue");
  const { language } = useLanguage();
  const { busy, error, submit } = useSubmit();
  if (addon === null || addon.ifAdded === null) return null;

  const money = (minor: number) => formatPrice(minor, language, "—");
  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
  const feature = words.featureName[addon.feature];
  const { owed, paysFrom } = addon.ifAdded;
  const price = money(addon.priceMinor);

  return (
    <Sheet open onClose={onClose} labelledBy="addon-add-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="addon-add-title" style={{ fontSize: 19 }}>
          {fillText(owed === null ? words.addonTitle : words.addonTitleAgain, { feature })}
        </h2>
        <p className="hint" style={{ margin: 0 }}>
          {what.featureWhat[addon.feature]}.
        </p>
        <Card style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 14px" }}>
          <span className="label" style={{ flex: 1 }}>
            {words.addonPrice}
          </span>
          <strong className="tab" style={{ fontSize: 15 }}>
            {fillText(words.addonPerMonth, { price })}
          </strong>
        </Card>
        <EffectBox
          tone="gives"
          title={words.addonWhatHappens}
          lines={[
            words.addonNow,
            owed === null
              ? fillText(words.addonPaysFrom, { price, date: shortDate(paysFrom) })
              : fillText(words.addonPaysAgain, {
                  owed: money(owed.amountMinor),
                  days: String(daysOf(owed)),
                  from: shortDate(owed.from),
                  through: shortDate(owed.through),
                  price,
                }),
            words.addonAnyTime,
          ]}
        />
        <NextTotal on={payment.on} from={payment.totalMinor} to={totalAfterAdding(payment, addon)} />
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          onClick={() =>
            void submit(async () => {
              await onAdd(addon.feature);
              onClose();
            })
          }
        >
          {owed === null ? fillText(words.addonDo, { price }) : fillText(words.addonDoOwed, { owed: money(owed.amountMinor) })}
        </Button>
      </div>
    </Sheet>
  );
};

const CancelSheet = ({
  addon,
  payment,
  onClose,
  onCancel,
}: {
  addon: AddonDto | null;
  payment: PaymentBoardDto["nextPayment"];
  onClose: () => void;
  onCancel: (feature: FeatureName) => Promise<void>;
}) => {
  const words = useCopy("billing");
  const { language } = useLanguage();
  const { busy, error, submit } = useSubmit();
  if (addon === null) return null;

  const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });

  return (
    <Sheet open onClose={onClose} labelledBy="addon-cancel-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="addon-cancel-title" style={{ fontSize: 19 }}>
          {fillText(words.addonCancelTitle, { feature: words.featureName[addon.feature] })}
        </h2>
        <EffectBox
          tone="takes"
          title={words.addonWhatHappens}
          lines={[
            fillText(words.addonStaysUntil, { date: shortDate(lastPaidDay(payment)) }),
            fillText(words.addonAfterEnd, { date: shortDate(payment.on) }),
            words.addonUndoUntil,
          ]}
        />
        <NextTotal on={payment.on} from={payment.totalMinor} to={totalAfterCancelling(payment, addon.feature)} />
        {error !== null && <Critical>{error}</Critical>}
        <Button
          intent="quiet"
          busy={busy}
          onClick={() =>
            void submit(async () => {
              await onCancel(addon.feature);
              onClose();
            })
          }
        >
          {words.addonCancelDo}
        </Button>
        <Button intent="primary" onClick={onClose}>
          {words.addonKeep}
        </Button>
      </div>
    </Sheet>
  );
};
