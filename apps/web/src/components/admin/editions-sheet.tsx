"use client";

import { useState, type ReactNode } from "react";
import { FEATURES } from "@tor-now/domain";
import type { PlanCatalogueDto, PlanViewDto } from "@/lib/api/types.ts";
import { editionColumns, type TableMode } from "@/lib/editions-table.ts";
import { formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Sheet } from "@/components/ui.tsx";
import { PlanBadge } from "@/components/billing-badges.tsx";

/**
 * Editions side by side (ADR 0020): every Plan's editions in use, or one
 * Plan's, as a table — the changed cells marked, and each Business count a way
 * into the Businesses list.
 */
export const EditionsSheet = ({
  open,
  onClose,
  catalogue,
  only,
  onShowBusinesses,
}: {
  open: boolean;
  onClose: () => void;
  catalogue: PlanCatalogueDto;
  /** One Plan's editions; every Plan's when absent. */
  only?: PlanViewDto["plan"];
  onShowBusinesses: (editionId: string) => void;
}) => {
  const words = useCopy("catalogue");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const [mode, setMode] = useState<TableMode>("IN_USE");
  const plans = only === undefined ? catalogue.plans : catalogue.plans.filter((view) => view.plan === only);
  const columns = editionColumns(plans, only === undefined ? mode : "IN_USE");
  const previewing = new Set(catalogue.previews.map((preview) => preview.feature));
  const title = only === undefined ? words.allTiersTitle : fillText(words.compareTitle, { plan: billing.plan[only] });

  const cell = (key: string, changed: boolean, children: ReactNode, tone?: "yes" | "no" | "preview") => (
    <td key={key} className={`tab${changed ? " changed" : ""}${tone === undefined ? "" : ` ${tone}`}`}>
      {children}
    </td>
  );

  return (
    <Sheet open={open} onClose={onClose} labelledBy="editions-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="editions-title" style={{ fontSize: 19 }}>
          {title}
        </h2>
        {only === undefined && (
          <div className="fp-seg" role="group" aria-label={title}>
            {(["IN_USE", "CURRENT"] as const).map((choice) => (
              <button key={choice} type="button" aria-pressed={mode === choice} onClick={() => setMode(choice)}>
                {choice === "IN_USE" ? words.allInUse : words.whatNewSees}
              </button>
            ))}
          </div>
        )}
        <div className="card editions-table" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th />
                {columns.map((column) => (
                  <th key={column.id} scope="col">
                    <PlanBadge plan={column.plan} version={column.number} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{words.rowState}</th>
                {columns.map((column) =>
                  cell(column.id, false, column.current ? words.stateCurrent : words.stateLeaving, column.current ? undefined : "no"),
                )}
              </tr>
              <tr>
                <th scope="row">{words.rowBusinesses}</th>
                {columns.map((column) => (
                  <td key={column.id} className="tab">
                    <button type="button" className="count-link" onClick={() => onShowBusinesses(column.id)}>
                      {column.businesses}
                    </button>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">{words.rowPrice}</th>
                {columns.map((column) => cell(column.id, column.changed.has("price"), formatPrice(column.priceMinor, language, "—")))}
              </tr>
              <tr>
                <th scope="row">{words.rowCalendars}</th>
                {columns.map((column) => cell(column.id, column.changed.has("calendars"), column.resourceAllowance))}
              </tr>
              {FEATURES.map((feature) => (
                <tr key={feature}>
                  <th scope="row">{billing.featureName[feature]}</th>
                  {columns.map((column) =>
                    column.features.includes(feature)
                      ? cell(column.id, column.changed.has(feature), "✓", "yes")
                      : previewing.has(feature)
                        ? cell(column.id, column.changed.has(feature), words.cellPreview, "preview")
                        : cell(column.id, column.changed.has(feature), "—", "no"),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {words.tableHint}
        </p>
      </div>
    </Sheet>
  );
};
