"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useRouter } from "next/navigation";
import type { BusinessDto, CustomerDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Card, Chip, Critical, Empty, Note, Spinner } from "../ui.tsx";

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

  if (customers === null) return <Spinner />;

  const needle = query.trim().toLowerCase();
  const shown = customers.filter(
    (customer) =>
      (standing === "ALL" || customer.blocked === (standing === "BLOCKED")) &&
      (needle === "" ||
        customer.name.toLowerCase().includes(needle) ||
        customer.phone.includes(needle)),
  );

  const filters = [
    ["ALL", copy.allCustomers],
    ["ACTIVE", copy.activeCustomer],
    ["BLOCKED", copy.blockedCustomer],
  ] as const;

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {filters.map(([value, label]) => (
          <Chip
            key={value}
            selected={standing === value}
            onClick={() => setStanding(value)}
          >
            {label}
          </Chip>
        ))}
      </div>

      <input
        className="field"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.searchCustomer}
        aria-label={copy.searchCustomer}
      />

      {error !== null && <Critical>{error}</Critical>}

      {shown.length === 0 ? (
        <Empty title={copy.noCustomers} body={copy.customerListNote} />
      ) : (
        shown.map((customer) => (
          <button
            key={customer.id}
            style={{ textAlign: "start" }}
            // A page rather than a sheet: the record is a name, a number,
            // three counts and a history that can run to dozens of rows, and
            // opening an appointment from inside a sheet meant a sheet on top
            // of a sheet.
            onClick={() =>
              router.push(`/manage/customers/${customer.id}?business=${business.id}`)
            }
          >
            <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{customer.name}</span>
                <span
                  className="hint"
                  style={customer.blocked ? { color: "var(--critical)" } : undefined}
                >
                  {customer.blocked ? copy.blockedCustomer : copy.activeCustomer}
                </span>
                <span className="hint tab" dir="ltr">{customer.phone}</span>
              </span>
            </Card>
          </button>
        ))
      )}

      {/* A customer exists because they booked; there is no manual add. */}
      <Note>{copy.customerListNote}</Note>

    </div>
  );
};
