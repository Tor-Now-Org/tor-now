"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  AppointmentDto,
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
  outcomeOfDto,
} from "@/components/owner/appointment-sheet.tsx";
import { PhoneActions } from "@/components/owner/phone-actions.tsx";
import { Card, Critical, Empty, Spinner } from "@/components/ui.tsx";

/**
 * One customer, laid out as the Screens canvas draws it: the initial in a
 * rounded square beside the name and number, the counts as a plain list of
 * label and value rather than a row of tiles, the appointments still to come as
 * cards you can open, and everything that already happened as a quiet ruled
 * list underneath.
 *
 * The two deliberate departures from the canvas are both things asked for
 * since: the number is a call link with a copy button, and a past appointment
 * opens too — the canvas only opens the upcoming ones, but cancelling or
 * marking a no show is exactly what an owner needs a finished one for.
 */
function CustomerPage({ customerId }: { customerId: string }) {
  const copy = useCopy("owner");
  const { language, direction } = useLanguage();
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

  /**
   * Back to the customers list, not to the calendar. The tab is in the URL for
   * exactly this: the owner came from a list, and returning them to a different
   * screen than the one they left is its own small betrayal.
   */
  const back = () =>
    router.push(
      businessId === null ? "/manage" : `/manage?business=${businessId}&tab=customers`,
    );

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
        <AppHeader languageLabel={copy.langSwitch} onBack={back} backLabel={copy.tabCustomers} />
        <main style={{ flex: 1, padding: 24 }}>
          {error === null ? <Spinner /> : <Critical>{error}</Critical>}
        </main>
      </>
    );
  }

  const locale = language === "he" ? "he-IL" : "en-GB";
  const dayAndTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: business.timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  const dateOnly = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: business.timeZone,
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).format(new Date(iso));

  const openable = (appointment: AppointmentDto) =>
    setOpen({
      ...appointment,
      customerName: record.user.name,
      customerPhone: record.user.phone,
    });

  // Soonest first for what is still to come, because that is the one being
  // asked about; most recent first for what is done, because that is the one
  // being remembered.
  const upcoming = record.appointments
    .filter((appointment) => outcomeOfDto(appointment) === "UPCOMING")
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const history = record.appointments
    .filter((appointment) => outcomeOfDto(appointment) !== "UPCOMING")
    .sort((left, right) => right.startAt.localeCompare(left.startAt));

  /**
   * When they became a customer *here*. The account may be older — the same
   * person books at other businesses with the same number — so this is the
   * first time they booked with this one.
   */
  const earliest = [...record.appointments].sort((left, right) =>
    left.startAt.localeCompare(right.startAt),
  )[0];

  return (
    <>
      <AppHeader
        languageLabel={copy.langSwitch}
        onBack={back}
        backLabel={copy.tabCustomers}
      />

      <main
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {error !== null && <Critical>{error}</Critical>}

        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <span
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: 54,
              height: 54,
              flexShrink: 0,
              borderRadius: 18,
              background: "var(--accent-soft)",
              color: "var(--accent-strong)",
              fontFamily: "Rubik, sans-serif",
              fontSize: 22,
            }}
          >
            {record.user.name.trim().charAt(0) || "?"}
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <h1 style={{ fontSize: 21 }}>{record.user.name}</h1>
            <span className="tab" dir="ltr" style={{ fontSize: 13, color: "var(--muted)" }}>
              {record.user.phone}
            </span>
          </span>
        </div>

        {/* Not on the canvas: what an owner reaches for when a customer needs
            ringing back. */}
        <PhoneActions
          phone={record.user.phone}
          labels={{ call: copy.callCustomer, copy: copy.copyPhone, copied: copy.copied }}
        />

        <Card style={{ padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
          <Count label={copy.since} value={earliest === undefined ? "—" : dateOnly(earliest.startAt)} />
          <Count label={copy.total} value={record.appointments.length} />
          <Count
            label={copy.lateCancels}
            value={record.lateCancellations}
            // The one number worth catching an eye, and only when there is one.
            tone={record.lateCancellations > 0 ? "var(--caution)" : undefined}
          />
          <Count label={copy.noShows} value={record.noShows} />
        </Card>

        {upcoming.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>{copy.upcoming}</span>
            {upcoming.map((appointment) => (
              <button
                key={appointment.id}
                className="card"
                onClick={() => openable(appointment)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "13px 14px",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    textAlign: "start",
                    minWidth: 0,
                  }}
                >
                  <span
                    className="tab"
                    style={{ fontSize: 14.5, fontWeight: 600, fontFamily: "Rubik, sans-serif" }}
                  >
                    {dayAndTime(appointment.startAt)}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {appointment.serviceName} · {appointment.durationMinutes} {copy.minutesShort}
                  </span>
                </span>
                <Chevron direction={direction} />
              </button>
            ))}
            <span className="hint">{copy.upcomingHint}</span>
          </div>
        )}

        <span style={{ fontSize: 12, color: "var(--faint)" }}>{copy.history}</span>
        {history.length === 0 ? (
          <Empty title={copy.noAppointments} body={copy.customerScopeNote} />
        ) : (
          history.map((appointment) => (
            <button
              key={appointment.id}
              onClick={() => openable(appointment)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid var(--line)",
                width: "100%",
                textAlign: "start",
              }}
            >
              <span className="tab" style={{ fontSize: 13, width: 92, flexShrink: 0 }}>
                {dateOnly(appointment.startAt)}
              </span>
              {/* The tag says what happened; the strike shows it. Only for a
                  cancellation — the rest of this list is simply the past, and
                  striking all of it would say nothing. */}
              <span
                className={isCancelled(appointment) ? "cancelled" : undefined}
                style={{ fontSize: 13.5, minWidth: 0 }}
              >
                {appointment.serviceName}
              </span>
              <span style={{ marginInlineStart: "auto", flexShrink: 0 }}>
                <StatusTag appointment={appointment} copy={copy} />
              </span>
            </button>
          ))
        )}

        <p className="hint" style={{ margin: 0 }}>{copy.customerScopeNote}</p>
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

const Count = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string | undefined;
}) => (
  <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
    <span style={{ color: "var(--faint)" }}>{label}</span>
    <span className="tab" style={{ fontWeight: 500, ...(tone === undefined ? {} : { color: tone }) }}>
      {value}
    </span>
  </span>
);

/** Points the way the reader is going, which is not always right. */
const Chevron = ({ direction }: { direction: "rtl" | "ltr" }) => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    style={{
      marginInlineStart: "auto",
      flexShrink: 0,
      transform: direction === "rtl" ? "scaleX(-1)" : undefined,
    }}
  >
    <path
      d="m9 6 6 6-6 6"
      stroke="var(--faint)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
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
