"use client";

import type { ReactNode } from "react";
import type { CostSourceName } from "@/lib/api/cost-types.ts";
import { orderedSources, percentOf, toneOf } from "@/lib/costs.ts";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * The small parts every Cost screen shares (ADR 0023): what a cost is made of,
 * a labelled figure, and the tags that say where a number came from.
 */

/** A cause's name: the ones every Business has, or a Feature's. */
export const useSourceName = (): ((source: CostSourceName) => string) => {
  const words = useCopy("costs");
  const billing = useCopy("billing");
  return (source) =>
    source in words.source
      ? words.source[source as keyof typeof words.source]
      : billing.featureName[source as keyof typeof billing.featureName];
};

/** What a cost is made of: one bar, one colour per cause, each with its share. */
export const CostSplit = ({ bySource }: { bySource: Partial<Record<CostSourceName, number>> }) => {
  const nameOf = useSourceName();
  const sources = orderedSources(bySource);
  const total = sources.reduce((sum, source) => sum + (bySource[source] ?? 0), 0);
  return (
    <div className="cost-split">
      <div className="bar" aria-hidden="true">
        {sources
          .filter((source) => (bySource[source] ?? 0) > 0)
          .map((source) => (
            <span key={source} style={{ flex: bySource[source], background: toneOf(source) }} />
          ))}
      </div>
      <div className="legend">
        {sources.map((source) => (
          <span key={source}>
            <i style={{ background: toneOf(source) }} />
            {nameOf(source)} <b className="tab">{percentOf(bySource[source] ?? 0, total)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
};

/** A figure with what it is above it and a word on it below. */
export const Figure = ({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string | undefined }) => (
  <div className="cost-figure">
    <span className="hint">{label}</span>
    <strong className="tab" style={tone === undefined ? undefined : { color: tone }}>
      {value}
    </strong>
    <span className="hint">{hint}</span>
  </div>
);

/** A reading, drawn where it is shown: nothing about it is stored. */
export const OverTag = () => {
  const words = useCopy("costs");
  return <span className="over-tag">{words.overTag}</span>;
};

/** Where a platform cost's figure comes from: measured from usage, or entered by hand. */
export const KindTag = ({ measured }: { measured: boolean }) => {
  const words = useCopy("costs");
  return <span className={`kind-tag${measured ? " measured" : ""}`}>{measured ? words.measured : words.fixed}</span>;
};

export const ToneOfMargin: Readonly<Record<string, string>> = {
  positive: "var(--positive)",
  caution: "var(--caution)",
  critical: "var(--critical)",
  muted: "var(--muted)",
};

/** A labelled row inside a card: a name on one side, a figure on the other. */
export const CostRow = ({ name, detail, value, first = false, trailing }: {
  name: ReactNode;
  detail?: ReactNode;
  value: ReactNode;
  first?: boolean;
  trailing?: ReactNode;
}) => (
  <div className={`cost-row${first ? " first" : ""}`}>
    <span className="what">
      <span className="name">{name}</span>
      {detail !== undefined && <span className="hint">{detail}</span>}
    </span>
    <strong className="tab">{value}</strong>
    {trailing}
  </div>
);
