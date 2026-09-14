"use client";

import { useMemo, useState } from "react";
import type { CustomerDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { checkLocalPhone, fromE164, localDigits, toE164 } from "@/lib/phone.ts";
import { PhoneField } from "@/components/phone-field.tsx";
import { Button, Field, Note } from "../ui.tsx";

export type ChosenCustomer = {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
};

/** Digits only, so "050-555-6677", "0505556677" and "5556677" all find her. */
const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * Whether a customer is who the typed words are about.
 *
 * Case-insensitively, which matters in exactly one of the two languages here —
 * see the note on `matchesQuery` in day-filter.ts, which learned this the hard
 * way.
 */
export const customerMatches = (
  customer: { name: string; phone: string },
  query: string,
): boolean => {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (customer.name.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase())) return true;
  const digits = digitsOf(trimmed);
  return digits !== "" && digitsOf(customer.phone).includes(digits);
};

/**
 * Who the appointment is for.
 *
 * The business's own customers, searched by name or number, with one way out
 * when the person on the telephone is not among them: a number that matches
 * nobody becomes the offer to write them down. That is the common case rather
 * than the exception — somebody ringing a shop for the first time has never
 * signed in, and refusing to book them until they do would be refusing the
 * booking.
 */
export const CustomerPicker = ({
  customers,
  loading,
  chosen,
  onChoose,
  onCreate,
  busy,
}: {
  customers: readonly CustomerDto[];
  loading: boolean;
  chosen: ChosenCustomer | null;
  onChoose: (customer: ChosenCustomer | null) => void;
  /** Writing down somebody new. Resolves to the customer, or throws. */
  onCreate: (input: { phone: string; givenName: string }) => Promise<void>;
  busy: boolean;
}) => {
  const copy = useCopy("owner");
  const [query, setQuery] = useState("");
  const [making, setMaking] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [touched, setTouched] = useState(false);

  const known = useMemo(
    () =>
      customers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        blocked: customer.blocked,
      })),
    [customers],
  );

  const matches = useMemo(
    () => known.filter((customer) => customerMatches(customer, query)).slice(0, 6),
    [known, query],
  );

  if (chosen !== null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{copy.customerWord}</span>
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
            borderRadius: 12,
          }}
        >
          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <b style={{ fontSize: 14 }}>{chosen.name}</b>
            <span className="hint tab" dir="ltr" style={{ textAlign: "start" }}>
              {chosen.phone}
            </span>
          </span>
          <Button intent="quiet" onClick={() => onChoose(null)} disabled={busy}>
            {copy.changeWord}
          </Button>
        </div>
      </div>
    );
  }

  if (making) {
    const problem = touched ? checkLocalPhone(newPhone) : null;
    const ready = newName.trim() !== "" && checkLocalPhone(newPhone) === null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="label">{copy.newCustomer}</span>
        <Field
          id="new-customer-name"
          label={copy.customerFirstName}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <PhoneField
          id="new-customer-phone"
          label={copy.customerPhone}
          value={newPhone}
          showProblem={problem !== null}
          onChange={setNewPhone}
          onBlur={() => setTouched(true)}
        />
        <Note>{copy.newCustomerNote}</Note>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            busy={busy}
            disabled={!ready}
            onClick={() =>
              void onCreate({ phone: toE164(newPhone), givenName: newName.trim() })
            }
          >
            {copy.save}
          </Button>
          <Button intent="quiet" onClick={() => setMaking(false)} disabled={busy}>
            {copy.back}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="label">{copy.customerWord}</span>
      <Field
        id="find-customer"
        label={copy.searchCustomer}
        placeholder={copy.searchCustomer}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {loading ? (
        <Note>{copy.loadingWord}</Note>
      ) : (
        matches.map((customer) => (
          <button
            key={customer.id}
            className="tap"
            style={{ textAlign: "start" }}
            disabled={customer.blocked}
            onClick={() =>
              onChoose({ id: customer.id, name: customer.name, phone: customer.phone })
            }
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 11px",
                border: "1px solid var(--line)",
                borderRadius: 12,
                opacity: customer.blocked ? 0.5 : 1,
              }}
            >
              <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <b style={{ fontSize: 13.5, fontWeight: 500 }}>{customer.name}</b>
                <span className="hint tab" dir="ltr" style={{ textAlign: "start" }}>
                  {fromE164(customer.phone) === ""
                    ? customer.phone
                    : `0${localDigits(fromE164(customer.phone))}`}
                </span>
              </span>
              {customer.blocked && <span className="hint">{copy.blockedCustomer}</span>}
            </span>
          </button>
        ))
      )}

      {/* Always offered, not only when the search comes back empty: the person
          taking the call knows perfectly well whether they have spoken to this
          customer before, and making them prove it by searching first is a
          step for the screen's benefit rather than theirs. */}
      {!loading && matches.length === 0 && query.trim() !== "" && (
        <Note>{copy.noCustomerFound}</Note>
      )}
      <Button
        intent="quiet"
        onClick={() => {
          setMaking(true);
          // A search that looks like a phone number is almost certainly the
          // number they were about to type again.
          const typed = digitsOf(query);
          if (typed.length >= 7) setNewPhone(typed.replace(/^0/, ""));
        }}
      >
        ＋ {copy.newCustomer}
      </Button>
    </div>
  );
};
