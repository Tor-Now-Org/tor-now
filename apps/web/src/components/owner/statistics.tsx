"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ResourceDto, StatisticsDto, StatisticsTotalsDto } from "@/lib/api/types.ts";
import { formatPrice, LOCALE, monthName, todayIn } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Chip, Critical, Spinner } from "@/components/ui.tsx";
import { shiftMonth } from "./month-model.ts";
import { bookedAtShortNotice, busiestDay, changeOf, daysCompared, monthAsked, monthsBetween } from "./statistics-model.ts";

const fill = (template: string, values: Readonly<Record<string, string | number>>) =>
  fillText(template, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])));

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * A Business's month in numbers (the Statistics Feature), for its owner.
 *
 * One month at a time, kept in the address so Back works and a link can be
 * sent. The arrows stop at the month the business opened and at this one.
 */
export const Statistics = ({
  token,
  business,
  resources,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
}) => {
  const copy = useCopy("statistics");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const router = useRouter();
  const params = useSearchParams();

  const thisMonth = `${todayIn(business.timeZone).slice(0, 7)}-01`;
  const asked = params.get("month");
  const [month, setMonth] = useState(monthAsked(asked, thisMonth));
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [page, setPage] = useState<StatisticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const calendars = resources.filter((resource) => resource.active);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPage(await api.statistics(token, business.id, month, resourceId));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, month, resourceId, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: string) => {
    setMonth(next);
    const query = new URLSearchParams(params.toString());
    query.set("tab", "statistics");
    query.set("month", next.slice(0, 7));
    router.replace(`/manage?${query.toString()}`);
  };

  const money = (minor: number) => formatPrice(minor, language, "₪0");
  const name = (first: string, length: "long" | "short" = "long") =>
    monthName(first, business.timeZone, language, length);

  const firstMonth = page?.firstMonth ?? month;
  const lastMonth = page?.currentMonth ?? thisMonth;
  const months = monthsBetween(firstMonth, lastMonth);

  return (
    <div style={{ padding: "10px 18px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 34 }}>
        <button
          className="chip tap"
          aria-label={copy.previousMonth}
          disabled={month <= firstMonth}
          onClick={() => go(shiftMonth(month, -1))}
          style={{ minWidth: 34, minHeight: 34 }}
        >
          ‹
        </button>
        <select
          className="st-month"
          aria-label={copy.chooseMonth}
          value={month}
          onChange={(event) => go(event.target.value)}
        >
          {(months.includes(month) ? months : [month, ...months]).map((one) => (
            <option key={one} value={one}>
              {name(one)}
            </option>
          ))}
        </select>
        <button
          className="chip tap"
          aria-label={copy.nextMonth}
          disabled={month >= lastMonth}
          onClick={() => go(shiftMonth(month, 1))}
          style={{ minWidth: 34, minHeight: 34 }}
        >
          ›
        </button>
      </div>

      {calendars.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip selected={resourceId === null} onClick={() => setResourceId(null)} style={{ minHeight: 34 }}>
            {copy.allCalendars}
          </Chip>
          {calendars.map((calendar) => (
            <Chip
              key={calendar.id}
              selected={resourceId === calendar.id}
              onClick={() => setResourceId(calendar.id)}
              style={{ minHeight: 34 }}
            >
              {calendar.name}
            </Chip>
          ))}
        </div>
      )}

      {error !== null && <Critical>{error}</Critical>}
      {page === null ? (
        error === null && <Spinner page />
      ) : (
        <Month
          page={page}
          money={money}
          name={name}
          rtl={language === "he"}
          compared={daysCompared(page.month, todayIn(business.timeZone), LOCALE[language])}
        />
      )}
    </div>
  );
};

type Copy = ReturnType<typeof useCopy<"statistics">>;

const Month = ({
  page,
  money,
  name,
  rtl,
  compared,
}: {
  page: StatisticsDto;
  money: (minor: number) => string;
  name: (first: string, length?: "long" | "short") => string;
  rtl: boolean;
  compared: ReturnType<typeof daysCompared>;
}) => {
  const copy = useCopy("statistics");
  const router = useRouter();
  const params = useSearchParams();
  const businessId = params.get("business");
  const openCustomer = (id: string) =>
    router.push(`/manage/customers/${id}${businessId === null ? "" : `?business=${businessId}`}`);

  const previousName = page.previous === null ? null : name(page.trend.at(-2)?.month ?? page.month, "short");
  const tile = (
    label: string,
    value: string,
    pick: (totals: StatisticsTotalsDto) => number | null,
    points = false,
  ) => (
    <div className="card st-tile" key={label}>
      <span className="label">{label}</span>
      <span className="st-value tab">{value}</span>
      <div className="st-tile-foot">
        <span className="hint">
          {page.previous !== null && previousName !== null && (
            <>
              <Delta copy={copy} now={pick(page.totals)} before={pick(page.previous)} points={points} />{" "}
              {fill(copy.versus, { month: previousName })}
            </>
          )}
        </span>
        <Spark values={page.trend.map((entry) => pick(entry.totals) ?? 0)} />
      </div>
    </div>
  );

  const seen = page.customers.seen;
  const outcomes = [
    [copy.completed, page.outcomes.completed],
    [copy.noShow, page.outcomes.noShow],
    [copy.lateCancellation, page.outcomes.lateCancellation],
    [copy.cancelledOnTime, page.outcomes.cancelledOnTime],
    [copy.cancelledByYou, page.outcomes.cancelledByBusiness],
  ] as const;
  const booked = page.leadTime.reduce((sum, count) => sum + count, 0);
  const shortNotice = bookedAtShortNotice(page.leadTime);
  const leadMax = Math.max(1, ...page.leadTime);
  const serviceMax = Math.max(1, ...page.services.map((service) => service.revenue));

  return (
    <>
      {compared !== null && page.previous !== null && <p className="hint st-so-far">{fill(copy.soFar, compared)}</p>}
      <div className="st-tiles">
        {tile(copy.revenue, money(page.totals.revenue), (totals) => totals.revenue)}
        {tile(copy.completed, String(page.totals.completed), (totals) => totals.completed)}
        {tile(
          copy.utilization,
          page.totals.utilization === null ? "—" : percent(page.totals.utilization),
          (totals) => totals.utilization,
          true,
        )}
        {tile(copy.newCustomers, String(page.totals.newCustomers), (totals) => totals.newCustomers)}
      </div>

      <section className="card st-card">
        <div className="st-head">
          <h3>{copy.daily}</h3>
          <Busiest page={page} copy={copy} />
        </div>
        <div className="st-legend">
          <span><i style={{ background: "var(--accent)" }} />{copy.completed}</span>
          <span><i style={{ background: "var(--critical)" }} />{copy.lost}</span>
          <span><i className="st-ahead" />{copy.upcoming}</span>
        </div>
        <Daily page={page} copy={copy} rtl={rtl} />
      </section>

      <section className="card st-card">
        <div className="st-head">
          <h3>{copy.byService}</h3>
          <span className="hint">{copy.completedOnly}</span>
        </div>
        {page.services.length === 0 ? (
          <span className="hint">{copy.nothingYet}</span>
        ) : (
          page.services.map((service) => (
            <div className="st-bar" key={service.name}>
              <span>{service.name}</span>
              <div className="st-track"><div style={{ width: `${(service.revenue / serviceMax) * 100}%` }} /></div>
              <span className="tab st-amount"><b>{money(service.revenue)}</b> · {service.completed}</span>
            </div>
          ))
        )}
      </section>

      {page.calendars.length > 1 && (
        <section className="card st-card">
          <div className="st-head">
            <h3>{copy.byCalendar}</h3>
            <span className="hint">{copy.utilizationMeans}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="st-table">
              <thead>
                <tr>
                  <th>{copy.calendar}</th>
                  <th>{copy.completed}</th>
                  <th>{copy.revenue}</th>
                  <th>{copy.averageTicket}</th>
                  <th>{copy.noShows}</th>
                  <th>{copy.utilization}</th>
                </tr>
              </thead>
              <tbody>
                {page.calendars.map((calendar) => (
                  <tr key={calendar.resourceId}>
                    <td>{calendar.name}</td>
                    <td className="tab">{calendar.completed}</td>
                    <td className="tab">{money(calendar.revenue)}</td>
                    <td className="tab">{calendar.completed === 0 ? "—" : money(Math.round(calendar.revenue / calendar.completed))}</td>
                    <td className="tab">{calendar.noShows}</td>
                    <td className="tab">{calendar.utilization === null ? "—" : percent(calendar.utilization)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="st-trio">
        <section className="card st-card">
          <h3>{copy.customers}</h3>
          <div className="st-pair">
            <div><span className="label">{copy.customersSeen}</span><b className="tab">{seen}</b></div>
            <div>
              <span className="label">{copy.visitsPerCustomer}</span>
              <b className="tab">{seen === 0 ? "—" : (page.outcomes.completed / seen).toFixed(1)}</b>
            </div>
          </div>
          {seen > 0 && (
            <div className="st-split" aria-hidden="true">
              <div style={{ width: `${(page.customers.returning / seen) * 100}%`, background: "var(--accent)" }} />
              <div style={{ width: `${(page.customers.new / seen) * 100}%`, background: "var(--positive)" }} />
            </div>
          )}
          <div className="st-legend">
            <span><i style={{ background: "var(--accent)" }} />{copy.returning} {page.customers.returning}</span>
            <span><i style={{ background: "var(--positive)" }} />{copy.new} {page.customers.new}</span>
          </div>
          <People
            rows={page.customers.top.map((entry) => ({
              id: entry.customerId,
              name: page.customerNames[entry.customerId] ?? "",
              note: fill(copy.visits, { count: entry.visits }),
            }))}
            onOpen={openCustomer}
          />
        </section>

        <section className="card st-card">
          <h3>{copy.appointments}</h3>
          <div className="st-rows">
            {outcomes.map(([label, count]) => (
              <div key={label}>
                <span>{label}</span>
                <span className="tab">{count}</span>
              </div>
            ))}
          </div>
          {page.repeatMisses.length > 0 && (
            <>
              <span className="hint">{copy.repeatMisses}</span>
              <People
                rows={page.repeatMisses.map((entry) => ({
                  id: entry.customerId,
                  name: page.customerNames[entry.customerId] ?? "",
                  note: fill(copy.times, { count: entry.times }),
                }))}
                onOpen={openCustomer}
              />
            </>
          )}
        </section>

        <section className="card st-card">
          <h3>{copy.leadTime}</h3>
          {page.leadTime.map((count, index) => (
            <div className="st-bar" key={copy.leadBuckets[index]}>
              <span>{copy.leadBuckets[index]}</span>
              <div className="st-track"><div style={{ width: `${(count / leadMax) * 100}%` }} /></div>
              <span className="tab st-amount">{booked === 0 ? "—" : percent(count / booked)}</span>
            </div>
          ))}
          {shortNotice !== null && (
            <span className="hint">{fill(copy.leadNote, { share: percent(shortNotice) })}</span>
          )}
        </section>
      </div>
    </>
  );
};

/** Up is good for every tile here; a rate moves in points, a count in percent. */
const Delta = ({
  copy,
  now,
  before,
  points,
}: {
  copy: Copy;
  now: number | null;
  before: number | null;
  points: boolean;
}) => {
  const change = changeOf(now, before, points);
  if (change.kind === "none") return null;
  if (change.kind === "same") return <span className="st-delta">{copy.same}</span>;
  return (
    <span className={`st-delta ${change.kind === "up" ? "good" : "bad"}`}>
      <bdi dir="ltr">
        {change.kind === "up" ? "▲" : "▼"} {change.amount}%
      </bdi>
    </span>
  );
};

const Spark = ({ values }: { values: readonly number[] }) => {
  if (values.length < 2) return null;
  const width = 64;
  const height = 22;
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const range = top - bottom || 1;
  const points = values.map((value, index) => [
    (index * (width - 4)) / (values.length - 1) + 2,
    height - 3 - ((value - bottom) / range) * (height - 6),
  ]);
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x?.toFixed(1)} ${y?.toFixed(1)}`).join("");
  const [lastX, lastY] = points.at(-1) ?? [0, 0];
  return (
    <svg className="st-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${line}L${lastX} ${height}L2 ${height}Z`} fill="var(--accent-soft)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="var(--accent)" />
    </svg>
  );
};

const Busiest = ({ page, copy }: { page: StatisticsDto; copy: Copy }) => {
  const { language } = useLanguage();
  const busiest = busiestDay(page.days);
  if (busiest === null) return null;
  const day = new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${busiest.date}T12:00:00Z`));
  return <span className="hint">{fill(copy.busiest, { day, count: busiest.completed })}</span>;
};

/** Days left to right, mirrored in Hebrew so the first of the month is where reading starts. */
const Daily = ({ page, copy, rtl }: { page: StatisticsDto; copy: Copy; rtl: boolean }) => {
  const [tip, setTip] = useState<string | null>(null);
  const width = 760;
  const height = 190;
  const left = 28;
  const bottom = 22;
  const topPad = 8;
  const most = Math.max(10, ...page.days.map((day) => day.completed + day.lost + day.upcoming));
  const top = Math.ceil(most / 5) * 5;
  const column = (width - left) / page.days.length;
  const bar = Math.min(16, column - 4);
  const scale = (value: number) => ((height - bottom - topPad) * value) / top;
  const x = (value: number) => (rtl ? width - value : value);
  const rect = (from: number, size: number) => (rtl ? width - from - size : from);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="st-daily"
        role="img"
        aria-label={copy.daily}
        onMouseLeave={() => setTip(null)}
      >
        {[0, 1, 2, 3, 4, 5].map((step) => {
          const value = (top / 5) * step;
          const y = height - bottom - scale(value);
          return (
            <g key={step}>
              <line x1={x(left)} x2={x(width)} y1={y} y2={y} stroke="var(--line)" strokeDasharray={step === 0 ? undefined : "2 3"} />
              <text x={x(left - 6)} y={y + 4} textAnchor={rtl ? "start" : "end"}>{value}</text>
            </g>
          );
        })}
        {page.days.map((day, index) => {
          const from = left + index * column + (column - bar) / 2;
          let base = height - bottom;
          const segment = (count: number, fill: string, extra: Record<string, string> = {}) => {
            if (count === 0) return null;
            const size = scale(count);
            base -= size;
            return <rect x={rect(from, bar)} y={base + 1} width={bar} height={Math.max(size - 2, 1)} rx={3} fill={fill} {...extra} />;
          };
          const label = Number(day.date.slice(8));
          return (
            <g key={day.date}>
              {segment(day.completed, "var(--accent)")}
              {segment(day.lost, "var(--critical)")}
              {segment(day.upcoming, "var(--accent-soft)", { stroke: "var(--accent)", strokeDasharray: "2 2" })}
              {!day.open && <text x={x(from + bar / 2)} y={height - bottom - 4} textAnchor="middle">·</text>}
              {(label === 1 || label % 5 === 0) && (
                <text x={x(from + bar / 2)} y={height - 6} textAnchor="middle">{label}</text>
              )}
              <rect
                x={rect(left + index * column, column)}
                y={topPad}
                width={column}
                height={height - bottom - topPad}
                fill="transparent"
                onMouseEnter={() =>
                  setTip(
                    `${label} · ${
                      day.open || day.completed + day.lost + day.upcoming > 0
                        ? fill(copy.dayTip, { completed: day.completed, lost: day.lost, upcoming: day.upcoming })
                        : copy.closed
                    }`,
                  )
                }
              />
            </g>
          );
        })}
      </svg>
      <span className="hint" style={{ minHeight: 18, display: "block" }}>{tip ?? " "}</span>
    </div>
  );
};

const People = ({
  rows,
  onOpen,
}: {
  rows: readonly { id: string; name: string; note: string }[];
  onOpen: (id: string) => void;
}) =>
  rows.length === 0 ? null : (
    <div className="st-people">
      {rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onOpen(row.id)}>
          <span>{row.name}</span>
          <span className="hint">{row.note}</span>
        </button>
      ))}
    </div>
  );
