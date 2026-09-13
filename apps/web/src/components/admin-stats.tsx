"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { PlatformStatsDto } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import type { Language } from "@/lib/i18n/index.tsx";
import { Card, Note } from "@/components/ui.tsx";

type AdminStatsCopy = {
  mrr: string;
  mrrHint: string;
  businessStatus: string;
  businessStatusHint: string;
  active: string;
  overdue: string;
  inactive: string;
  planMix: string;
  planMixHint: string;
  free: string;
  standard: string;
  signups: string;
  signupsHint: string;
  businesses: string;
  users: string;
  appointmentActivity: string;
  appointmentActivityHint: string;
  confirmed: string;
  cancelled: string;
  noShow: string;
  completed: string;
  topBusinesses: string;
  topBusinessesHint: string;
  noData: string;
};

const BAR_HEIGHT = 90;
/** Bars are scaled to leave headroom above the tallest one for its value label. */
const PLOT_HEIGHT = BAR_HEIGHT - 16;

type TooltipState = { x: number; y: number; text: string } | null;

/** A chart's own hover state, positioned in the pixels of whatever wraps its svg. */
const useChartTooltip = () => {
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const show = (event: ReactMouseEvent<SVGElement>, text: string) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (bounds === undefined) return;
    setTooltip({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, text });
  };
  const hide = () => setTooltip(null);
  return { tooltip, show, hide };
};

/** The floating value/label bubble a hovered bar reveals. */
const ChartTooltip = ({ tooltip }: { tooltip: TooltipState }) =>
  tooltip === null ? null : (
    <div
      style={{
        position: "absolute",
        left: tooltip.x,
        top: tooltip.y,
        transform: "translate(-50%, -100%) translateY(-8px)",
        background: "var(--ink)",
        color: "var(--on-accent)",
        fontSize: 12,
        fontWeight: 500,
        padding: "4px 8px",
        borderRadius: 8,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {tooltip.text}
    </div>
  );

/** A small "i" mark that reveals what the thing beside it means, on hover or focus. */
const InfoTip = ({ text }: { text: string }) => (
  <span
    title={text}
    tabIndex={0}
    role="img"
    aria-label={text}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 14,
      height: 14,
      flex: "none",
      borderRadius: 999,
      border: "1px solid var(--faint)",
      color: "var(--faint)",
      fontSize: 10,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1,
      cursor: "help",
    }}
  >
    i
  </span>
);

/** A section's label, paired with the tooltip that explains what it shows. */
const Heading = ({ label, hint }: { label: string; hint: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span className="label">{label}</span>
    <InfoTip text={hint} />
  </div>
);

const Legend = ({
  entries,
}: {
  entries: readonly { label: string; color: string }[];
}) => (
  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
    {entries.map((entry) => (
      <span key={entry.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: entry.color, display: "inline-block" }} />
        {entry.label}
      </span>
    ))}
  </div>
);

/** Grouped bars: one or two series per label (a week or a month), scaled to the tallest bar shown. */
const GroupedBars = ({
  labels,
  series,
}: {
  labels: readonly string[];
  series: readonly { name: string; color: string; values: readonly number[] }[];
}) => {
  const max = Math.max(1, ...series.flatMap((line) => line.values));
  const barsPerLabel = series.length;
  const { tooltip, show, hide } = useChartTooltip();
  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${labels.length * 40} ${BAR_HEIGHT + 20}`}
        style={{ width: "100%", height: BAR_HEIGHT + 20 }}
        role="img"
        aria-label={labels.map((label, i) => `${label}: ${series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(", ")}`).join("; ")}
      >
        {labels.map((label, labelIndex) => (
          <g key={label} transform={`translate(${labelIndex * 40}, 0)`}>
            {series.map((line, seriesIndex) => {
              const value = line.values[labelIndex] ?? 0;
              const barWidth = 30 / barsPerLabel - 2;
              const height = (value / max) * PLOT_HEIGHT;
              const x = 5 + seriesIndex * (barWidth + 2);
              return (
                <g key={seriesIndex}>
                  <text
                    x={x + barWidth / 2}
                    y={BAR_HEIGHT - height - 4}
                    fontSize={10.5}
                    fontWeight={600}
                    fill="var(--ink)"
                    textAnchor="middle"
                  >
                    {value}
                  </text>
                  <rect
                    x={x}
                    y={BAR_HEIGHT - height}
                    width={Math.max(barWidth, 1)}
                    height={Math.max(height, 1)}
                    rx={2}
                    fill={line.color}
                    onMouseEnter={(event) => show(event, `${label} · ${line.name}: ${value}`)}
                    onMouseMove={(event) => show(event, `${label} · ${line.name}: ${value}`)}
                    onMouseLeave={hide}
                  >
                    <title>{`${label} · ${line.name}: ${value}`}</title>
                  </rect>
                </g>
              );
            })}
            <text x={20} y={BAR_HEIGHT + 14} fontSize={9} fill="var(--faint)" textAnchor="middle">
              {label}
            </text>
          </g>
        ))}
      </svg>
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
};

/** One stacked bar per week — confirmed, cancelled, no-show, completed. */
const StackedBars = ({
  weeks,
  stacks,
}: {
  weeks: readonly string[];
  stacks: readonly { name: string; totals: readonly number[]; color: string }[];
}) => {
  const totalsPerWeek = weeks.map((_, weekIndex) =>
    stacks.reduce((sum, stack) => sum + (stack.totals[weekIndex] ?? 0), 0),
  );
  const max = Math.max(1, ...totalsPerWeek);
  const { tooltip, show, hide } = useChartTooltip();
  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${weeks.length * 40} ${BAR_HEIGHT + 20}`}
        style={{ width: "100%", height: BAR_HEIGHT + 20 }}
        role="img"
        aria-label={weeks.map((label, i) => `${label}: ${totalsPerWeek[i]} total, ${stacks.map((s) => `${s.name} ${s.totals[i] ?? 0}`).join(", ")}`).join("; ")}
      >
        {weeks.map((label, weekIndex) => {
          let cursor = BAR_HEIGHT;
          const total = totalsPerWeek[weekIndex] ?? 0;
          const totalHeight = (total / max) * PLOT_HEIGHT;
          return (
            <g key={label} transform={`translate(${weekIndex * 40}, 0)`}>
              <text x={20} y={BAR_HEIGHT - totalHeight - 4} fontSize={10.5} fontWeight={600} fill="var(--ink)" textAnchor="middle">
                {total}
              </text>
              {stacks.map((stack, stackIndex) => {
                const value = stack.totals[weekIndex] ?? 0;
                const height = (value / max) * PLOT_HEIGHT;
                cursor -= height;
                const text = `${label} · ${stack.name}: ${value}`;
                return (
                  <rect
                    key={stackIndex}
                    x={5}
                    y={cursor}
                    width={30}
                    height={height}
                    fill={stack.color}
                    onMouseEnter={(event) => show(event, text)}
                    onMouseMove={(event) => show(event, text)}
                    onMouseLeave={hide}
                  >
                    <title>{text}</title>
                  </rect>
                );
              })}
              <text x={20} y={BAR_HEIGHT + 14} fontSize={9} fill="var(--faint)" textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTooltip tooltip={tooltip} />
    </div>
  );
};

const StatusDonutRow = ({
  active,
  overdue,
  inactive,
  labels,
}: {
  active: number;
  overdue: number;
  inactive: number;
  labels: { active: string; overdue: string; inactive: string };
}) => {
  const total = Math.max(1, active + overdue + inactive);
  const segments = [
    { value: active, color: "var(--positive)", label: labels.active },
    { value: overdue, color: "var(--caution)", label: labels.overdue },
    { value: inactive, color: "var(--critical)", label: labels.inactive },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden" }}>
        {segments.map((segment) => (
          <div
            key={segment.label}
            style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
        {segments.map((segment) => (
          <span key={segment.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: segment.color, display: "inline-block" }} />
            {segment.label}: <strong>{segment.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
};

export const AdminStats = ({
  stats,
  copy,
  language,
}: {
  stats: PlatformStatsDto;
  copy: AdminStatsCopy;
  language: Language;
}) => {
  const weekLabel = (weekStart: string) => formatLocalDate(weekStart, language, { day: "numeric", month: "numeric" });
  const monthLabel = (monthStart: string) => formatLocalDate(monthStart, language, { month: "short" });
  const activityWeeks = stats.appointmentActivityByWeek.map((week) => weekLabel(week.weekStart));
  const signupMonths = stats.businessSignupsByMonth.map((month) => monthLabel(month.monthStart));
  const maxTopVolume = Math.max(1, ...stats.topBusinesses.map((row) => row.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Heading label={copy.businessStatus} hint={copy.businessStatusHint} />
        <StatusDonutRow
          {...stats.businessStatusCounts}
          labels={{ active: copy.active, overdue: copy.overdue, inactive: copy.inactive }}
        />
      </Card>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Card style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hint" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {copy.mrr} <InfoTip text={copy.mrrHint} />
          </span>
          <span style={{ fontSize: 22, fontWeight: 600 }}>
            {formatPrice(stats.monthlyRecurringRevenueMinor, language, "—")}
          </span>
        </Card>
        <Card style={{ flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hint" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {copy.planMix} <InfoTip text={copy.planMixHint} />
          </span>
          <span style={{ fontSize: 15 }}>
            {copy.free} <strong>{stats.planCounts.FREE}</strong> · {copy.standard}{" "}
            <strong>{stats.planCounts.STANDARD}</strong>
          </span>
        </Card>
      </div>

      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Heading label={copy.signups} hint={copy.signupsHint} />
        {signupMonths.length === 0 ? (
          <Note>{copy.noData}</Note>
        ) : (
          <>
            <GroupedBars
              labels={signupMonths}
              series={[
                { name: copy.businesses, color: "var(--accent)", values: stats.businessSignupsByMonth.map((month) => month.count) },
                { name: copy.users, color: "var(--caution)", values: stats.userSignupsByMonth.map((month) => month.count) },
              ]}
            />
            <Legend
              entries={[
                { label: copy.businesses, color: "var(--accent)" },
                { label: copy.users, color: "var(--caution)" },
              ]}
            />
          </>
        )}
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Heading label={copy.appointmentActivity} hint={copy.appointmentActivityHint} />
        {activityWeeks.length === 0 ? (
          <Note>{copy.noData}</Note>
        ) : (
          <>
            <StackedBars
              weeks={activityWeeks}
              stacks={[
                { name: copy.confirmed, color: "var(--positive)", totals: stats.appointmentActivityByWeek.map((week) => week.confirmed) },
                { name: copy.cancelled, color: "var(--critical)", totals: stats.appointmentActivityByWeek.map((week) => week.cancelled) },
                { name: copy.noShow, color: "var(--caution)", totals: stats.appointmentActivityByWeek.map((week) => week.noShow) },
                { name: copy.completed, color: "var(--muted)", totals: stats.appointmentActivityByWeek.map((week) => week.completed) },
              ]}
            />
            <Legend
              entries={[
                { label: copy.confirmed, color: "var(--positive)" },
                { label: copy.cancelled, color: "var(--critical)" },
                { label: copy.noShow, color: "var(--caution)" },
                { label: copy.completed, color: "var(--muted)" },
              ]}
            />
          </>
        )}
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Heading label={copy.topBusinesses} hint={copy.topBusinessesHint} />
        {stats.topBusinesses.length === 0 ? (
          <Note>{copy.noData}</Note>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.topBusinesses.map((row) => (
              <div key={row.businessId} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                  <span>{row.businessName}</span>
                  <span className="tab" style={{ fontWeight: 600 }}>{row.count}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                  <div style={{ width: `${(row.count / maxTopVolume) * 100}%`, height: "100%", background: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
