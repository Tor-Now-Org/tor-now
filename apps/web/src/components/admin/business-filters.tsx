"use client";

import { useEffect, useId, type CSSProperties } from "react";
import {
  BILLING_FLAGS,
  BILLING_STATUSES,
  type DirectoryFilter,
  type DirectoryPageDto,
  type PlanName,
} from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { fillText } from "@/lib/i18n/fill.ts";
import { Button } from "@/components/ui.tsx";
import { STATUS_TONE } from "@/components/billing-badges.tsx";
import { choicesMade, choosePlan, resetChoices, toggleFlag, toggleStatus } from "./directory-filter.ts";

const FilterIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * The one Filters button and the panel it opens. Every option shows how many
 * Businesses choosing it would give, counted on the server, and the panel's
 * last button says how many will show — so nobody filters their way into an
 * empty table without being told first.
 */
export const BusinessFilters = ({
  filter,
  counts,
  matching,
  open,
  onOpenChange,
  onChange,
}: {
  filter: DirectoryFilter;
  counts: DirectoryPageDto["counts"] | null;
  /** How many Businesses the current filter shows. */
  matching: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (filter: DirectoryFilter) => void;
}) => {
  const copy = useCopy("admin");
  const billing = useCopy("billing");
  const titleId = useId();
  const chosen = choicesMade(filter);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onOpenChange]);

  const planCount = (plan: PlanName | null): number =>
    counts === null
      ? 0
      : plan === null
        ? counts.plans.SOLO + counts.plans.TEAM
        : counts.plans[plan];

  return (
    <div className="filters-anchor">
      <button
        type="button"
        className={`filters-btn${chosen > 0 ? " on" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
      >
        <FilterIcon />
        {copy.filters}
        {chosen > 0 && <span className="count tab">{chosen}</span>}
      </button>

      {open && (
        <>
          <div className="filters-scrim" role="presentation" onClick={() => onOpenChange(false)} />
          <div className="filters-panel" role="dialog" aria-labelledby={titleId}>
            <div className="grabber" />
            <div className="fp-head">
              <h2 id={titleId}>{copy.filters}</h2>
              <button type="button" disabled={chosen === 0} onClick={() => onChange(resetChoices(filter))}>
                {copy.reset}
              </button>
            </div>

            <div className="fp-section">
              <span className="label">
                {billing.state}
                <small>{copy.pickSeveral}</small>
              </span>
              <div className="fp-pills">
                {BILLING_STATUSES.map((status) => {
                  const n = counts?.statuses[status] ?? 0;
                  const on = filter.statuses.includes(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      className="fp-pill"
                      aria-pressed={on}
                      disabled={n === 0 && !on}
                      style={{ "--tone": STATUS_TONE[status].ink, "--tone-soft": STATUS_TONE[status].ground } as CSSProperties}
                      onClick={() => onChange(toggleStatus(filter, status))}
                    >
                      <i className="dot" />
                      <span className="name">{billing.status[status]}</span>
                      <small>{n}</small>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="fp-section">
              <span className="label">{billing.plans}</span>
              <div className="fp-seg" role="group" aria-label={billing.plans}>
                {([null, "SOLO", "TEAM"] as const).map((plan) => (
                  <button
                    key={plan ?? "ALL"}
                    type="button"
                    aria-pressed={filter.plan === plan}
                    onClick={() => onChange(choosePlan(filter, plan))}
                  >
                    {plan === null ? copy.all : billing.plan[plan]}
                    <small>{planCount(plan)}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="fp-section">
              <span className="label">{copy.attention}</span>
              {BILLING_FLAGS.map((flag) => {
                const n = counts?.flags[flag] ?? 0;
                const on = filter.flags.includes(flag);
                const off = n === 0 && !on;
                return (
                  <label key={flag} className={`fp-toggle${off ? " off" : ""}`}>
                    <span className="what">
                      {billing.flag[flag]}
                      <em>{billing.flagMeaning[flag]}</em>
                    </span>
                    <small>{n}</small>
                    <span className="switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={on}
                        disabled={off}
                        onChange={() => onChange(toggleFlag(filter, flag))}
                      />
                      <i />
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="fp-foot">
              <Button disabled={matching === 0} onClick={() => onOpenChange(false)}>
                {matching === 0 ? copy.noneMatch : fillText(copy.showN, { n: String(matching) })}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
