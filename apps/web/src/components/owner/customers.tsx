"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, CustomerRecordDto, UserDto } from "@/lib/api/types.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Card, Critical, Empty, Note, Sheet, Spinner } from "../ui.tsx";

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
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [customers, setCustomers] = useState<UserDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [record, setRecord] = useState<CustomerRecordDto | null>(null);
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

  const formatWhen = (iso: string) =>
    new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
      timeZone: business.timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));

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
            onClick={() =>
              api
                .customerRecord(token, business.id, customer.id)
                .then(setRecord)
                .catch((cause) =>
                  setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")),
                )
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

      <Sheet open={record !== null} onClose={() => setRecord(null)}>
        {record !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h2 style={{ fontSize: 20 }}>{record.user.name}</h2>
              <span className="hint tab" dir="ltr">{record.user.phone}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <Stat label={copy.total} value={record.appointments.length} />
              <Stat label={copy.lateCancels} value={record.lateCancellations} />
              <Stat label={copy.noShows} value={record.noShows} />
            </div>

            <span className="label">{copy.history}</span>
            {record.appointments.map((appointment) => (
              <Card key={appointment.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontWeight: 500 }}>{appointment.serviceName}</span>
                <span className="hint">{formatWhen(appointment.startAt)}</span>
              </Card>
            ))}

            <Note>{copy.customerScopeNote}</Note>
          </div>
        )}
      </Sheet>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 2,
      alignItems: "center",
      padding: "12px 6px",
      borderRadius: 14,
      background: "var(--sunken)",
    }}
  >
    <span className="tab" style={{ fontSize: 20, fontFamily: "Rubik, sans-serif", fontWeight: 600 }}>
      {value}
    </span>
    <span className="hint" style={{ textAlign: "center", fontSize: 11 }}>{label}</span>
  </div>
);
