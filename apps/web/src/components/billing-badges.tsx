import type { BillingFlag, BillingStatus, PlanName } from "@/lib/api/types.ts";
import { daysUntil } from "@/lib/billing-alert.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";

/**
 * One shape per kind of billing fact, so a glance tells them apart: a status
 * is a filled pill with a dot, a plan an outlined tag, a flag a small square
 * tag. The same three everywhere the owner or an administrator meets them.
 */

export const StatusBadge = ({ status }: { status: BillingStatus }) => {
  const copy = useCopy("billing");
  return <span className={`status-badge s-${status}`}>{copy.status[status]}</span>;
};

export const PlanBadge = ({ plan, version }: { plan: PlanName; version?: number }) => {
  const copy = useCopy("billing");
  return (
    <span className={`plan-badge p-${plan}`}>
      {copy.plan[plan]}
      {version === undefined ? null : <small className="tab">v{version}</small>}
    </span>
  );
};

/** Only a Trial about to end is loud; the other flags are for finding, not alarm. */
export const FlagTag = ({ flag, short = false }: { flag: BillingFlag; short?: boolean }) => {
  const copy = useCopy("billing");
  return (
    <span className={`flag-tag${flag === "TRIAL_ENDING" ? " hot" : ""}`}>
      {short ? copy.flagShort[flag] : copy.flag[flag]}
    </span>
  );
};

/** A status's ink and ground, for anything that colours by status beyond the badge. */
export const STATUS_TONE: Readonly<Record<BillingStatus, { ink: string; ground: string }>> = {
  TRIAL: { ink: "var(--accent-strong)", ground: "var(--accent-soft)" },
  PAID: { ink: "var(--positive)", ground: "var(--positive-soft)" },
  IN_GRACE: { ink: "var(--caution)", ground: "var(--caution-soft)" },
  LAPSED: { ink: "var(--critical)", ground: "var(--critical-soft)" },
  DEACTIVATED: { ink: "var(--blocked)", ground: "var(--blocked-soft)" },
};

/**
 * The date a status turns on, said the way the status means it — "Trial ends
 * 23.09 · in 7 days" — and counted from the Business's own today.
 */
export const NextDate = ({
  status,
  date,
  timeZone,
  stacked = false,
}: {
  status: BillingStatus;
  date: string | null;
  timeZone: string;
  stacked?: boolean;
}) => {
  const copy = useCopy("billing");
  const { language } = useLanguage();
  if (date === null) return <span className="hint">—</span>;
  const days = daysUntil(date, timeZone);
  const relative =
    days === 0
      ? copy.today
      : fillText(days > 0 ? copy.inDays : copy.daysAgo, { n: String(Math.abs(days)) });
  const soon = (status === "TRIAL" || status === "IN_GRACE") && days >= 0 && days <= 7;
  const when = formatLocalDate(date, language, { day: "2-digit", month: "2-digit" });
  return stacked ? (
    <span className={`dir-when${soon ? " soon" : ""}`}>
      <span>{copy.dateLabel[status]}</span>
      <b className="tab">{when} · {relative}</b>
    </span>
  ) : (
    <span>
      {copy.dateLabel[status]} <b className="tab">{when}</b> · {relative}
    </span>
  );
};
