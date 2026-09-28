"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { DirectoryFilter, DirectoryPageDto, DirectoryRowDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { fillText } from "@/lib/i18n/fill.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Card, Critical, Note } from "@/components/ui.tsx";
import { FlagTag, NextDate, PlanBadge, STATUS_TONE, StatusBadge } from "@/components/billing-badges.tsx";
import { BusinessFilters } from "./business-filters.tsx";
import { resetChoices, tokensOf, withoutToken, type Token } from "./directory-filter.ts";

const PAGE_SIZE = 50;
/** Long enough that typing a name is one request, short enough to feel live. */
const SEARCH_PAUSE_MS = 250;

/**
 * The Businesses tab: a search, one Filters button, and the list. Filtering,
 * counting and sorting happen on the server over every Business, so what the
 * list says matches is what matches — not what the first page happened to hold.
 */
export const BusinessDirectory = ({
  token,
  filter,
  onFilterChange,
  onOpen,
  refreshKey,
}: {
  token: string;
  filter: DirectoryFilter;
  onFilterChange: (filter: DirectoryFilter) => void;
  onOpen: (row: DirectoryRowDto) => void;
  /** Bumped by the page after an action, so the list reads again. */
  refreshKey: number;
}) => {
  const copy = useCopy("admin");
  const billing = useCopy("billing");
  const errorText = useErrorText();
  const [page, setPage] = useState<DirectoryPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .adminBusinesses(token, filter, { limit: PAGE_SIZE, offset: 0 }, controller.signal)
        .then((loaded) => {
          setPage(loaded);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
        });
    }, SEARCH_PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [token, filter, refreshKey, errorText]);

  const loadMore = async () => {
    if (page === null) return;
    setLoadingMore(true);
    try {
      const next = await api.adminBusinesses(token, filter, { limit: PAGE_SIZE, offset: page.rows.length });
      setPage({ ...next, rows: [...page.rows, ...next.rows] });
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setLoadingMore(false);
    }
  };

  const tokens = tokensOf(filter);
  const searching = filter.query.trim() !== "";
  const editionLabel = (id: string): string => {
    const edition = page?.counts.editions?.find((candidate) => candidate.id === id);
    return edition === undefined ? "—" : `${billing.plan[edition.plan]} v${edition.number}`;
  };
  const tokenLabel = (item: Token): string => {
    switch (item.kind) {
      case "status":
        return billing.status[item.value];
      case "plan":
        return billing.plan[item.value];
      case "edition":
        return editionLabel(item.value);
      case "flag":
        return billing.flag[item.value];
    }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="field"
          style={{ flex: 1 }}
          value={filter.query}
          onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
          placeholder={copy.searchBusiness}
          aria-label={copy.searchBusiness}
        />
        <BusinessFilters
          filter={filter}
          counts={page?.counts ?? null}
          matching={page?.total ?? 0}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          onChange={onFilterChange}
        />
      </div>

      {error !== null && <Critical>{error}</Critical>}

      {page !== null && (
        <div className="dir-results" aria-live="polite">
          <span>
            {fillText(copy.showing, { n: String(page.total), total: String(page.counts.total) })}
          </span>
          {tokens.map((item) => (
            <span key={`${item.kind}:${item.value}`} className="dir-token">
              {item.kind === "status" && (
                <i className="dot" style={{ "--tone": STATUS_TONE[item.value].ink } as CSSProperties} />
              )}
              {tokenLabel(item)}
              <button
                type="button"
                aria-label={`${copy.remove} ${tokenLabel(item)}`}
                onClick={() => onFilterChange(withoutToken(filter, item))}
              >
                ×
              </button>
            </span>
          ))}
          {(tokens.length > 0 || searching) && (
            <button
              type="button"
              className="clear"
              onClick={() => onFilterChange({ ...resetChoices(filter), query: "" })}
            >
              {copy.clearFilters}
            </button>
          )}
          <span className="sort">{copy.soonestFirst}</span>
        </div>
      )}

      {page !== null && page.rows.length === 0 && <Note>{copy.noResults}</Note>}

      {page !== null && page.rows.length > 0 && (
        <>
          <div className="dir-table">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {[copy.colBusiness, billing.plans, billing.state, copy.colNextDate, ""].map((head, at) => (
                    <th key={at} style={{
                      textAlign: "start", padding: "8px 10px", borderBottom: "1px solid var(--line)",
                      color: "var(--muted)", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap",
                    }}>
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.business.id} className="tap" style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                    onClick={() => onOpen(row)}>
                    <td style={{ padding: "14px 10px" }}>
                      <span className="dir-who">
                        <strong>{row.business.name}</strong>
                        <span>
                          {row.ownerName ?? "—"} · <span className="tab" dir="ltr">{row.ownerPhone ?? "—"}</span>
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: "14px 10px" }}><PlanBadge plan={row.plan} /></td>
                    <td style={{ padding: "14px 10px" }}><StatusBadge status={row.status} /></td>
                    <td style={{ padding: "14px 10px", whiteSpace: "nowrap" }}>
                      <NextDate status={row.status} date={row.nextDate} timeZone={row.business.timeZone} stacked />
                    </td>
                    <td style={{ padding: "14px 10px" }}>
                      <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {row.flags.map((flag) => <FlagTag key={flag} flag={flag} short />)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dir-cards">
            {page.rows.map((row) => (
              <Card key={row.business.id} padded={false}>
                <button type="button" className="dir-card" onClick={() => onOpen(row)}>
                  <span className="top">
                    <span className="dir-who">
                      <strong>{row.business.name}</strong>
                      <span>{row.ownerName ?? "—"}</span>
                    </span>
                    <StatusBadge status={row.status} />
                  </span>
                  <span className="bottom">
                    <PlanBadge plan={row.plan} />
                    <NextDate status={row.status} date={row.nextDate} timeZone={row.business.timeZone} />
                    {row.flags.map((flag) => <FlagTag key={flag} flag={flag} short />)}
                  </span>
                </button>
              </Card>
            ))}
          </div>

          {page.rows.length < page.total && (
            <Button intent="quiet" busy={loadingMore} onClick={() => void loadMore()}>
              {copy.loadMore}
            </Button>
          )}
        </>
      )}
    </>
  );
};
