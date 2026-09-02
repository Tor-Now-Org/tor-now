"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useRouter } from "next/navigation";
import type { BusinessDto, UserDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Card, Critical, Empty, Note, Spinner } from "../ui.tsx";

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

  const [customers, setCustomers] = useState<UserDto[] | null>(null);
  const [query, setQuery] = useState("");
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
  const shown =
    needle === ""
      ? customers
      : customers.filter(
          (customer) =>
            customer.name.toLowerCase().includes(needle) ||
            customer.phone.includes(needle),
        );

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <input
        className="field"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.searchCustomer}
        aria-label={copy.searchCustomer}
      />

      {error !== null && <Critical>{error}</Critical>}

      {shown.length === 0 ? (
        <Empty title={copy.noAppointments} body={copy.customerListNote} />
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
