"use client";

import type { CalendarAppointmentDto, ResourceDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Button, Sheet } from "../ui.tsx";
import {
  NOTHING,
  anyFilter,
  countOfFilters,
  customersIn,
  matchesQuery,
  type Facets,
  type Reach,
  type Status,
} from "./day-filter.ts";

/**
 * The two ways into a filtered view, and the one state they produce.
 *
 * Whatever set a filter, it ends up as a chip that can be seen and removed. The
 * day is never narrowed invisibly: if the screen is not showing the whole day, a
 * chip is saying why.
 */

const STATUSES: readonly Status[] = ["UPCOMING", "SPENT", "CANCELLED"];

export const FilterControls = ({
  query,
  onQuery,
  facets,
  onFacets,
  suggestions,
  onSheet,
  sheetOpen,
  resources,
  services,
}: {
  query: string;
  onQuery: (value: string) => void;
  facets: Facets;
  onFacets: (facets: Facets) => void;
  /** Appointments the query might be about, for naming the person meant. */
  suggestions: readonly CalendarAppointmentDto[];
  onSheet: (open: boolean) => void;
  sheetOpen: boolean;
  resources: readonly ResourceDto[];
  services: readonly string[];
}) => {
  const copy = useCopy("owner");
  const people = customersIn(suggestions).filter((one) => matchesQuery(one, query));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <input
          className="field"
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={copy.findAppointment}
          aria-label={copy.findAppointment}
          style={{ flex: 1 }}
        />
        <button
          className="chip tap"
          onClick={() => onSheet(true)}
          style={{
            minHeight: 40,
            gap: 6,
            ...(anyFilter(facets)
              ? {
                  background: "var(--accent-soft)",
                  borderColor: "oklch(52% 0.123 245/.3)",
                  color: "var(--accent-strong)",
                }
              : {}),
          }}
        >
          <span>{copy.filterWord}</span>
          {countOfFilters(facets) > 0 && (
            <span
              style={{
                minWidth: 17,
                height: 17,
                padding: "0 4px",
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--on-accent)",
                fontSize: 10,
                fontWeight: 600,
                display: "grid",
                placeItems: "center",
              }}
            >
              {countOfFilters(facets)}
            </span>
          )}
        </button>
      </div>

      {/* A person is chosen, not guessed: two customers called יעל are two
          rows, and picking one is what makes the filter unambiguous. */}
      {facets.customer === null && query.trim() !== "" && people.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {people.slice(0, 4).map((person) => (
            <button
              key={person.phone}
              // The query stays: it is what found her, and the results behind
              // the chip are the answer to it. Clearing it here emptied the
              // list the chip was pointing at.
              onClick={() => onFacets({ ...facets, customer: person })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 10px",
                borderRadius: 11,
                border: "1px solid var(--line)",
                background: "var(--raised)",
                textAlign: "start",
                width: "100%",
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "var(--sunken)",
                  color: "var(--muted)",
                }}
              >
                {copy.customerWord}
              </span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{person.name}</span>
              <span className="hint tab">{person.phone}</span>
            </button>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onClose={() => onSheet(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 18 }}>{copy.filterWord}</h2>

          {resources.length > 1 && (
            <Facet
              title={copy.calendarsWord}
              values={resources.map((one) => ({ key: one.id, label: one.name }))}
              chosen={facets.calendars}
              onToggle={(key) =>
                onFacets({ ...facets, calendars: toggled(facets.calendars, key) })
              }
            />
          )}
          {services.length > 0 && (
            <Facet
              title={copy.servicesWord}
              values={services.map((name) => ({ key: name, label: name }))}
              chosen={facets.services}
              onToggle={(key) =>
                onFacets({ ...facets, services: toggled(facets.services, key) })
              }
            />
          )}
          <Facet
            title={copy.statusWord}
            values={STATUSES.map((status) => ({
              key: status,
              label:
                status === "UPCOMING"
                  ? copy.statusUpcoming
                  : status === "SPENT"
                    ? copy.statusSpent
                    : copy.cancelledTag,
            }))}
            chosen={facets.statuses}
            onToggle={(key) =>
              onFacets({
                ...facets,
                statuses: toggled(facets.statuses, key) as Status[],
              })
            }
          />

          <Button onClick={() => onSheet(false)}>{copy.showResults}</Button>
          <Button
            intent="quiet"
            onClick={() => {
              onFacets({ ...NOTHING, customer: facets.customer });
              onSheet(false);
            }}
          >
            {copy.clearFilters}
          </Button>
        </div>
      </Sheet>
    </>
  );
};

/** The chips saying why the day is not the whole day. */
export const ActiveFilters = ({
  facets,
  onFacets,
  resources,
  reach,
  onReach,
  count,
}: {
  facets: Facets;
  onFacets: (facets: Facets) => void;
  resources: readonly ResourceDto[];
  reach: Reach;
  onReach: (reach: Reach) => void;
  count: number;
}) => {
  const copy = useCopy("owner");
  const nameOf = (id: string) => resources.find((one) => one.id === id)?.name ?? id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        {facets.customer !== null && (
          <Chip
            title={copy.customerWord}
            label={facets.customer.name}
            onRemove={() => onFacets({ ...facets, customer: null })}
          />
        )}
        {facets.calendars.map((id) => (
          <Chip
            key={id}
            title={copy.calendarsWord}
            label={nameOf(id)}
            onRemove={() =>
              onFacets({ ...facets, calendars: toggled(facets.calendars, id) })
            }
          />
        ))}
        {facets.services.map((name) => (
          <Chip
            key={name}
            title={copy.servicesWord}
            label={name}
            onRemove={() => onFacets({ ...facets, services: toggled(facets.services, name) })}
          />
        ))}
        {facets.statuses.map((status) => (
          <Chip
            key={status}
            title={copy.statusWord}
            label={
              status === "UPCOMING"
                ? copy.statusUpcoming
                : status === "SPENT"
                  ? copy.statusSpent
                  : copy.cancelledTag
            }
            onRemove={() =>
              onFacets({ ...facets, statuses: toggled(facets.statuses, status) as Status[] })
            }
          />
        ))}
        <button className="chip tap" onClick={() => onFacets(NOTHING)} style={{ minHeight: 28 }}>
          {copy.clearFilters}
        </button>
      </div>

      {/* Reach appears only once something is filtered: reading a day needs
          none, and looking for a person always does. */}
      {facets.customer !== null && (
        <div style={{ display: "flex", gap: 3, padding: 3, background: "var(--sunken)", borderRadius: 999 }}>
          {(["DAY", "WEEK", "ALL"] as const).map((candidate) => (
            <button
              key={candidate}
              onClick={() => onReach(candidate)}
              aria-pressed={reach === candidate}
              style={{
                flex: 1,
                minHeight: 30,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                background: reach === candidate ? "var(--raised)" : "transparent",
                color: reach === candidate ? "var(--ink)" : "var(--muted)",
              }}
            >
              {candidate === "DAY"
                ? copy.reachDay
                : candidate === "WEEK"
                  ? copy.reachWeek
                  : copy.reachAll}
            </button>
          ))}
        </div>
      )}

      <span className="hint">{count} {copy.appointmentsWord}</span>
    </div>
  );
};

const Chip = ({
  title,
  label,
  onRemove,
}: {
  title: string;
  label: string;
  onRemove: () => void;
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      minHeight: 28,
      padding: "0 6px 0 10px",
      borderRadius: 999,
      background: "var(--accent-soft)",
      border: "1px solid oklch(52% 0.123 245/.28)",
      color: "var(--accent-strong)",
      fontSize: 11,
    }}
  >
    <span>{title}</span>
    <b style={{ fontWeight: 600 }}>{label}</b>
    <button
      onClick={onRemove}
      aria-label={`${title} ${label}`}
      style={{
        width: 17,
        height: 17,
        borderRadius: 999,
        background: "oklch(52% 0.123 245/.15)",
        fontSize: 9,
      }}
    >
      ✕
    </button>
  </span>
);

const Facet = ({
  title,
  values,
  chosen,
  onToggle,
}: {
  title: string;
  values: readonly { key: string; label: string }[];
  chosen: readonly string[];
  onToggle: (key: string) => void;
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span className="label">{title}</span>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {values.map((value) => {
        const on = chosen.includes(value.key);
        return (
          <button
            key={value.key}
            className="chip"
            aria-pressed={on}
            onClick={() => onToggle(value.key)}
            style={{
              minHeight: 34,
              padding: "0 12px",
              background: on ? "var(--accent)" : "var(--raised)",
              color: on ? "var(--on-accent)" : "var(--ink)",
              border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {value.label}
          </button>
        );
      })}
    </div>
  </div>
);

const toggled = (values: readonly string[], key: string): string[] =>
  values.includes(key) ? values.filter((one) => one !== key) : [...values, key];
