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
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { AppointmentSheet, outcomeOfDto } from "@/components/owner/appointment-sheet.tsx";
import { RecordBand, RecordTiles } from "@/components/owner/customer-record/record-band.tsx";
import { UpcomingCard } from "@/components/owner/customer-record/upcoming-card.tsx";
import { HistoryList } from "@/components/owner/customer-record/history-list.tsx";
import { monthAndYear } from "@/components/owner/customer-record/record-dates.ts";
import { ListRow } from "@/components/owner/list-ui.tsx";
import { Button, Critical, Empty, Sheet, Spinner } from "@/components/ui.tsx";
import { Locked, useLockText } from "@/components/locked.tsx";

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
  const words = useCopy("lists");
  const billingCopy = useCopy("billing");
  const locks = useLockText();
  const { language } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const { token, loading } = useSession();
  const errorText = useErrorText();

  const businessId = params.get("business");

  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [record, setRecord] = useState<CustomerRecordDto | null>(null);
  const [open, setOpen] = useState<CalendarAppointmentDto | null>(null);
  const [blocking, setBlocking] = useState(false);
  /** The question before a block, said once, at the moment it matters. */
  const [askingToBlock, setAskingToBlock] = useState(false);
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

  /** A block stops the next booking; it does not touch the ones already made. */
  const toggleBlocked = async (blocked: boolean) => {
    if (token === null || businessId === null) return;
    setBlocking(true);
    try {
      await api.setCustomerBlocked(token, businessId, customerId, blocked);
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBlocking(false);
    }
  };

  /**
   * Back to the customers list, not to the calendar. The tab is in the URL for
   * exactly this: the owner came from a list, and returning them to a different
   * screen than the one they left is its own small betrayal.
   */
  const back = () =>
    router.push(
      businessId === null ? "/manage" : `/manage?business=${businessId}&tab=customers`,
    );

  if (loading) return <Spinner page />;

  if (token === null || businessId === null) {
    return (
      <>
        <AppHeader onBack={back} backLabel={copy.back} />
        <main style={{ flex: 1, padding: 24 }}>
          <Empty title={copy.usingAs} body={copy.oneIdentity} />
        </main>
      </>
    );
  }

  if (record === null || business === null) {
    return (
      <>
        <AppHeader onBack={back} backLabel={copy.tabCustomers} />
        <main style={{ flex: 1, padding: 24 }}>
          {error === null ? <Spinner page /> : <Critical>{error}</Critical>}
        </main>
      </>
    );
  }

  const openable = (appointment: AppointmentDto) =>
    setOpen({
      ...appointment,
      customerName: record.user.name,
      customerPhone: record.user.phone,
    });

  // Without Customer History (ADR 0019) the page still books and still shows
  // what is coming; the past, its counts and blocking become one lock.
  const historyShown = record.historyIncluded !== false;
  const upcoming = record.appointments
    .filter((appointment) => outcomeOfDto(appointment) === "UPCOMING")
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const history = record.appointments
    .filter((appointment) => outcomeOfDto(appointment) !== "UPCOMING")
    .sort((left, right) => right.startAt.localeCompare(left.startAt));
  const earliest = [...record.appointments].sort((left, right) => left.startAt.localeCompare(right.startAt))[0];
  const since = historyShown && earliest !== undefined ? monthAndYear(earliest.startAt, business.timeZone, language) : null;
  // Absent for an owner looking at their own record: barring yourself from your
  // own chair is not a thing the API will do. Without the Feature a block can
  // still be lifted; only a new one is the plan's to allow.
  const canBlock = record.blockable !== false && (historyShown || record.blocked);
  const book = () => router.push(`/manage?business=${businessId}&book=${encodeURIComponent(record.user.id)}`);

  return (
    <>
      <AppHeader onBack={back} backLabel={copy.tabCustomers} />

      <main className="scroll record-page">
        <RecordBand name={record.user.name} phone={record.user.phone} since={since} blocked={record.blocked} />

        <div className="record-body">
          {error !== null && <Critical>{error}</Critical>}

          {historyShown ? (
            <RecordTiles
              visits={record.appointments.length}
              noShows={record.noShows ?? 0}
              lateCancels={record.lateCancellations ?? 0}
            />
          ) : (
            <Locked
              {...locks.feature("CUSTOMER_HISTORY")}
              {...((business.role ?? "OWNER") === "OWNER"
                ? {
                    action: billingCopy.seePlans,
                    onAction: () => router.push(`/manage?business=${businessId}&tab=business&panel=billing`),
                  }
                : {})}
            />
          )}

          <UpcomingCard upcoming={upcoming} zone={business.timeZone} onOpen={openable} />

          {historyShown && <HistoryList history={history} zone={business.timeZone} onOpen={openable} />}

          {canBlock && (
            <ul className="list-card" aria-label={record.blocked ? words.unblockRow : words.blockRow}>
              {record.blocked ? (
                <ListRow
                  title={words.unblockRow}
                  line={words.unblockRowLine}
                  onClick={() => void toggleBlocked(false)}
                />
              ) : (
                <ListRow
                  title={words.blockRow}
                  line={words.blockRowLine}
                  tone="danger"
                  onClick={() => setAskingToBlock(true)}
                />
              )}
            </ul>
          )}

          <p className="list-foot">{copy.customerScopeNote}</p>
        </div>

        {/* "While I have you" — said on the telephone, with this page open. A
            blocked customer cannot be booked, and a button that is absent says
            so more kindly than a refusal. */}
        {!record.blocked && (
          <div className="record-go">
            <Button onClick={book}>{fillText(words.bookFor, { name: record.user.givenName || record.user.name })}</Button>
          </div>
        )}
      </main>

      <Sheet open={askingToBlock} onClose={() => setAskingToBlock(false)} labelledBy="block-ask-title">
        <div className="sheet-body">
          <h2 id="block-ask-title" style={{ fontSize: 19 }}>
            {fillText(words.blockAsk, { name: record.user.name })}
          </h2>
          <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>{words.blockAskBody}</p>
          <Button
            intent="danger"
            busy={blocking}
            onClick={() =>
              void toggleBlocked(true).then(() => setAskingToBlock(false))
            }
          >
            {words.block}
          </Button>
          <Button intent="quiet" onClick={() => setAskingToBlock(false)}>
            {words.cancel}
          </Button>
        </div>
      </Sheet>

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


export default function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = use(params);
  return (
    <Suspense fallback={<Spinner page />}>
      <CustomerPage customerId={customerId} />
    </Suspense>
  );
}
