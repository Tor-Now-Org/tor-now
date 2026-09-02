"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  CalendarAppointmentDto,
  CustomerRecordDto,
} from "@/lib/api/types.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AppHeader } from "@/components/app-header.tsx";
import {
  AppointmentSheet,
  StatusTag,
  isCancelled,
  isSpent,
} from "@/components/owner/appointment-sheet.tsx";
import { CopyablePhone } from "@/components/owner/copyable-phone.tsx";
import { Card, Critical, Empty, Note, Spinner } from "@/components/ui.tsx";

/**
 * One customer, on a page of their own.
 *
 * This was a bottom sheet, which is the wrong shape for it: the record is a
 * name, a phone number, three counts and a history that can run to dozens of
 * rows, and opening an appointment from inside it meant a sheet on top of a
 * sheet. A page has a back button, a URL an owner can keep open on a second
 * tab, and room for the history to be as long as it is.
 */
function CustomerPage({ customerId }: { customerId: string }) {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const { token, loading } = useSession();
  const errorText = useErrorText();

  const businessId = params.get("business");

  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [record, setRecord] = useState<CustomerRecordDto | null>(null);
  const [open, setOpen] = useState<CalendarAppointmentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (token === null || businessId === null) return;
    try {
      const mine = await api.myBusinesses(token);
      const chosen = mine.find((candidate) => candidate.id === businessId) ?? null;
      setBusiness(chosen);
      if (chosen !== null) {
        setRecord(await api.customerRecord(token, chosen.id, customerId));
      }
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, businessId, customerId, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = () =>
    router.push(businessId === null ? "/manage" : `/manage?business=${businessId}`);

  if (loading) return <Spinner />;

  if (token === null || businessId === null) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} onBack={back} backLabel={copy.back} />
        <main style={{ flex: 1, padding: 24 }}>
          <Empty title={copy.usingAs} body={copy.oneIdentity} />
        </main>
      </>
    );
  }

  if (record === null || business === null) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} onBack={back} backLabel={copy.back} />
        <main style={{ flex: 1, padding: 24 }}>
          {error === null ? <Spinner /> : <Critical>{error}</Critical>}
        </main>
      </>
    );
  }

  const when = (iso: string) =>
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
    <>
      <AppHeader
        languageLabel={copy.langSwitch}
        onBack={back}
        backLabel={copy.tabCustomers}
        title={record.user.name}
      />

      <main
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          padding: "16px 18px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {error !== null && <Critical>{error}</Critical>}

        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CopyablePhone
            phone={record.user.phone}
            labels={{ call: copy.callCustomer, copy: copy.copyPhone, copied: copy.copied }}
          />
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <Stat label={copy.total} value={record.appointments.length} />
          <Stat label={copy.lateCancels} value={record.lateCancellations} />
          <Stat label={copy.noShows} value={record.noShows} />
        </div>

        <span className="label">{copy.history}</span>
        {record.appointments.length === 0 ? (
          <Empty title={copy.noAppointments} body={copy.customerScopeNote} />
        ) : (
          record.appointments.map((appointment) => (
            <button
              key={appointment.id}
              style={{ textAlign: "start" }}
              // The same actions as the calendar, from where the owner is
              // actually looking: a customer rings up, and the appointment is
              // in front of you rather than three taps into a date.
              onClick={() =>
                setOpen({
                  ...appointment,
                  customerName: record.user.name,
                  customerPhone: record.user.phone,
                })
              }
            >
              <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  className={
                    isCancelled(appointment)
                      ? "cancelled"
                      : isSpent(appointment)
                        ? "spent"
                        : undefined
                  }
                  style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span style={{ fontWeight: 500 }}>{appointment.serviceName}</span>
                  <span className="hint">{when(appointment.startAt)}</span>
                </span>
                <StatusTag appointment={appointment} copy={copy} />
              </Card>
            </button>
          ))
        )}

        <Note>{copy.customerScopeNote}</Note>
      </main>

      <AppointmentSheet
        token={token}
        business={business}
        appointment={open}
        onClose={() => setOpen(null)}
        onChanged={load}
      />
    </>
  );
}

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

export default function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = use(params);
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<Spinner />}>
      <CustomerPage customerId={customerId} />
    </Suspense>
  );
}
