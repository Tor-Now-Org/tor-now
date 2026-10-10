"use client";

import { useCallback, useEffect, useState } from "react";
import { matchesPerson, peopleSearchOf } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useRouter } from "next/navigation";
import type { BusinessDto, CustomerDto } from "@/lib/api/types.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { fillText } from "@/lib/i18n/fill.ts";
import { phoneShown } from "@/lib/phone.ts";
import { byName, standingCounts, withLetters } from "./list-model.ts";
import { Initial, ListCard, ListDivider, ListHead, ListRow, ListTag } from "./list-ui.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Critical, Empty, Spinner } from "../ui.tsx";

/** Blocking is per-Business, so a standing is too: here, not everywhere. */
type Standing = "ALL" | "ACTIVE" | "BLOCKED";

/**
 * A Business's customers. "Customer" is always relative to a Business — the
 * counts below are this business's own, and the same person may look entirely
 * different at another one, which the note says out loud.
 */
export const Customers = ({
  token,
  business,
}: {
  token: string;
  business: BusinessDto;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("lists");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const router = useRouter();

  const [customers, setCustomers] = useState<CustomerDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [standing, setStanding] = useState<Standing>("ALL");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCustomers(await api.listCustomers(token, business.id));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  if (customers === null) return <Spinner page />;

  // The same rule the server searches by: a whole name, or a number as it is
  // written here — "055-351-9297" as much as "+972553519297".
  const search = peopleSearchOf(query);
  const counts = standingCounts(customers);
  const shown = byName(
    customers.filter(
      (customer) =>
        (standing === "ALL" || customer.blocked === (standing === "BLOCKED")) &&
        (search.text === "" || matchesPerson(customer, search)),
    ),
    language,
  );

  const filters = [
    ["ALL", fillText(words.filterAll, { n: String(counts.all) })],
    ["ACTIVE", fillText(words.filterActive, { n: String(counts.active) })],
    ["BLOCKED", fillText(words.filterBlocked, { n: String(counts.blocked) })],
  ] as const;

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <ListHead
        id="customers-title"
        title={words.customers}
        count={counts.all}
        countLabel={fillText(words.countOf, { title: words.customers, n: String(counts.all) })}
      />

      <input
        className="field"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.searchCustomer}
        aria-label={copy.searchCustomer}
      />

      <div className="list-filters" role="group" aria-label={words.filters}>
        {filters.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={standing === value} onClick={() => setStanding(value)}>
            {label}
          </button>
        ))}
      </div>

      {error !== null && <Critical>{error}</Critical>}

      {shown.length === 0 ? (
        <Empty title={copy.noCustomers} body={copy.customerListNote} />
      ) : (
        <ListCard labelledBy="customers-title">
          {withLetters(shown).map((entry) =>
            entry.kind === "letter" ? (
              <ListDivider key={`letter-${entry.text}`} text={entry.text} />
            ) : (
              <ListRow
                key={entry.item.id}
                dataId={entry.item.id}
                title={entry.item.name}
                line={<span dir="ltr">{phoneShown(entry.item.phone)}</span>}
                leading={<Initial name={entry.item.name} />}
                tags={entry.item.blocked ? <ListTag text={words.blocked} tone="critical" /> : undefined}
                onClick={() => router.push(`/manage/customers/${entry.item.id}?business=${business.id}`)}
              />
            ),
          )}
        </ListCard>
      )}

      {/* Said once: in the empty state when there is nobody, under the list when there is. */}
      {shown.length > 0 && <p className="list-foot">{copy.customerListNote}</p>}
    </div>
  );
};
