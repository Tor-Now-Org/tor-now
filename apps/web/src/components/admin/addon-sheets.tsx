"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { FeatureViewDto } from "@/lib/api/types.ts";
import { priceChange, risePending } from "@/lib/addon-catalogue.ts";
import { formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { priceMinorOf } from "@/lib/plan-edit.ts";
import { useSubmit } from "@/lib/use-submit.ts";
import { Button, Card, Critical, Field, Note, Sheet, Spinner, Warning } from "@/components/ui.tsx";
import { EffectBox } from "@/components/effect-box.tsx";
import { usePlanCatalogue } from "./use-plan-catalogue.ts";

/**
 * Selling a Feature on its own (ADR 0021), from the Features tab: putting it on
 * sale, changing its price, withdrawing a rise, and stopping the sale. Each
 * sheet says what saving will do before anything is saved.
 */

type Saved = (features: FeatureViewDto[]) => void;
type SheetProps = { view: FeatureViewDto | null; token: string; today: string; onClose: () => void; onSaved: Saved };

const usePrice = () => {
  const { language } = useLanguage();
  return (minor: number) => formatPrice(minor, language, "—");
};

const useListOf = () => {
  const billing = useCopy("billing");
  const { language } = useLanguage();
  return (plans: readonly FeatureViewDto["plans"][number]["plan"][]) =>
    new Intl.ListFormat(language === "he" ? "he-IL" : "en-GB", { type: "conjunction" }).format(
      plans.map((plan) => billing.plan[plan]),
    );
};

export const SellAddonSheet = ({ view, token, onClose, onSaved, onSale }: SheetProps & { onSale: number }) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const money = usePrice();
  const list = useListOf();
  const [price, setPrice] = useState("");
  const { businessesOn, catalogue } = usePlanCatalogue(token, view !== null);
  const { busy, error, submit } = useSubmit();
  if (view === null) return null;

  const priceMinor = priceMinorOf(price);
  const valid = priceMinor !== null && priceMinor > 0;
  const lacking = view.plans.filter((plan) => !plan.included).map((plan) => plan.plan);
  const reached = lacking.reduce((sum, plan) => sum + businessesOn(plan), 0);
  const feature = billing.featureName[view.feature];

  return (
    <Sheet open onClose={onClose} labelledBy="sell-addon-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="sell-addon-title" style={{ fontSize: 19 }}>
          {fillText(words.sellTitle, { feature })}
        </h2>
        <Note>{words.sellNote}</Note>
        <Field
          id="addon-price"
          label={words.addonPriceLabel}
          hint={words.addonPriceHint}
          inputMode="numeric"
          dir="ltr"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        <span className="label">{words.whoCanBuy}</span>
        {catalogue === null ? (
          <Spinner />
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {view.plans.map((plan) => (
              <div key={plan.plan} className="place-row">
                <span className="head">
                  <span className={`plan-badge p-${plan.plan}`}>{billing.plan[plan.plan]}</span>
                  <span className="hint">
                    {plan.included ? words.notOffered : fillText(words.businessesN, { n: String(businessesOn(plan.plan)) })}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        {valid && (
          <EffectBox
            tone="gives"
            title={words.givesTitle}
            lines={[
              fillText(words.sellGives, { n: String(reached), plans: list(lacking), feature, price: money(priceMinor) }),
              words.sellNobodyCharged,
              words.sellTold,
            ]}
          />
        )}
        <p className="hint" style={{ margin: 0 }}>
          {onSale === 0 ? words.sellFirst : words.sellSecond}
        </p>
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={!valid}
          onClick={() =>
            void submit(async () => {
              if (priceMinor === null) return;
              onSaved((await api.adminSellAddon(token, view.feature, priceMinor)).features);
              onClose();
            })
          }
        >
          {words.sellDo}
        </Button>
      </div>
    </Sheet>
  );
};

export const AddonPriceSheet = ({ view, token, today, onClose, onSaved }: SheetProps) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const money = usePrice();
  const [price, setPrice] = useState("");
  const { busy, error, submit } = useSubmit();
  const addon = view?.addon ?? null;
  if (view === null || addon === null) return null;

  const next = priceMinorOf(price);
  const change = priceChange(addon.priceMinor, next);
  const holders = view.counts.ADDON ?? 0;
  const waiting = change === "RISE" && risePending(addon.rise, today);
  const to = money(next ?? 0);

  const effect = (() => {
    if (change === "RISE" && !waiting) {
      return holders === 0 ? (
        <Note>{fillText(words.riseNobody, { price: to })}</Note>
      ) : (
        <EffectBox
          tone="takes"
          title={fillText(words.riseTitle, { n: String(holders) })}
          lines={[
            fillText(words.riseReaches, { price: to, old: money(addon.priceMinor) }),
            words.riseTold,
            fillText(words.riseNewBuyers, { price: to }),
            words.riseCancellable,
          ]}
        />
      );
    }
    if (change === "DROP") {
      return (
        <EffectBox
          tone="gives"
          title={words.givesTitle}
          lines={[
            ...(holders === 0 ? [] : [fillText(words.dropReaches, { n: String(holders), price: to })]),
            words.lineToldApp,
          ]}
        />
      );
    }
    return null;
  })();

  return (
    <Sheet open onClose={onClose} labelledBy="addon-price-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="addon-price-title" style={{ fontSize: 19 }}>
          {fillText(words.priceTitle, { feature: billing.featureName[view.feature] })}
        </h2>
        <Card style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <span className="label" style={{ flex: 1 }}>
            {words.now}
          </span>
          <strong className="tab" style={{ fontSize: 14.5 }}>
            {fillText(billing.addonPerMonth, { price: money(addon.priceMinor) })}
          </strong>
        </Card>
        <Field
          id="addon-new-price"
          label={words.newAddonPrice}
          inputMode="numeric"
          dir="ltr"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        {effect}
        {waiting && <Warning>{words.risePending}</Warning>}
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          disabled={change === "SAME" || change === "INVALID" || waiting}
          onClick={() =>
            void submit(async () => {
              if (next === null) return;
              onSaved((await api.adminAddonPrice(token, view.feature, next)).features);
              onClose();
            })
          }
        >
          {change === "RISE" && holders > 0 ? fillText(words.riseDo, { n: String(holders) }) : change === "SAME" ? words.noChange : words.saveNow}
        </Button>
      </div>
    </Sheet>
  );
};

export const StopAddonSheet = ({ view, token, onClose, onSaved }: SheetProps) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { busy, error, submit } = useSubmit();
  if (view === null || (view.addon ?? null) === null) return null;

  return (
    <Sheet open onClose={onClose} labelledBy="stop-addon-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="stop-addon-title" style={{ fontSize: 19 }}>
          {fillText(words.stopTitle, { feature: billing.featureName[view.feature] })}
        </h2>
        <EffectBox
          tone="gives"
          title={words.stopBoxTitle}
          lines={[
            words.stopNoMore,
            ...((view.counts.ADDON ?? 0) === 0 ? [] : [fillText(words.stopHoldersKeep, { n: String(view.counts.ADDON ?? 0) })]),
            words.stopFreesPlace,
          ]}
        />
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          onClick={() =>
            void submit(async () => {
              onSaved((await api.adminStopAddon(token, view.feature)).features);
              onClose();
            })
          }
        >
          {words.stopAddon}
        </Button>
      </div>
    </Sheet>
  );
};

export const CancelRiseSheet = ({ view, token, onClose, onSaved }: SheetProps) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const money = usePrice();
  const { busy, error, submit } = useSubmit();
  const rise = view?.addon?.rise ?? null;
  if (view === null || rise === null) return null;

  return (
    <Sheet open onClose={onClose} labelledBy="cancel-rise-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="cancel-rise-title" style={{ fontSize: 19 }}>
          {fillText(words.cancelRiseTitle, { feature: billing.featureName[view.feature] })}
        </h2>
        <EffectBox
          tone="gives"
          title={words.givesTitle}
          lines={[fillText(words.cancelRiseBack, { price: money(rise.fromMinor) }), words.cancelRiseTold]}
        />
        {error !== null && <Critical>{error}</Critical>}
        <Button
          busy={busy}
          onClick={() =>
            void submit(async () => {
              onSaved((await api.adminCancelAddonRise(token, view.feature)).features);
              onClose();
            })
          }
        >
          {words.cancelAddonRise}
        </Button>
      </div>
    </Sheet>
  );
};
