"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  AllowlistEntryDto,
  AppointmentDto,
  AuditEntryDto,
  BusinessSummaryDto,
  PaymentDto,
  SubscriptionDto,
  SubscriptionState,
  UserDto,
} from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { BottomNav, BuildingIcon, PeopleIcon, ShieldIcon } from "@/components/bottom-nav.tsx";
import { Button, Card, Critical, Empty, Field, Note, Sheet, Spinner, Warning } from "@/components/ui.tsx";

type Tab = "businesses" | "users" | "system";
type SystemPanel = "admins" | "allowlist" | "audit";

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * ADR 0010's scope, and nothing beyond it. Impersonation is absent by design:
 * no screen here can act as another User, because an impersonated action would
 * record the wrong actor and make every dispute unresolvable.
 */
export default function AdminPage() {
  const copy = useCopy("admin");
  const router = useRouter();
  const { language } = useLanguage();
  const { token, user, loading } = useSession();
  const errorText = useErrorText();

  const [tab, setTab] = useState<Tab>("businesses");
  const [systemPanel, setSystemPanel] = useState<SystemPanel>("admins");
  const [businesses, setBusinesses] = useState<BusinessSummaryDto[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [administrators, setAdministrators] = useState<UserDto[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntryDto[]>([]);
  const [audit, setAudit] = useState<AuditEntryDto[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openBusiness, setOpenBusiness] = useState<BusinessSummaryDto | null>(null);
  const [billing, setBilling] = useState<{
    subscription: SubscriptionDto;
    payments: PaymentDto[];
    state: SubscriptionState;
  } | null>(null);
  const [editReason, setEditReason] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [openUser, setOpenUser] = useState<{ user: UserDto; appointments: AppointmentDto[] } | null>(null);
  const [newAllowed, setNewAllowed] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (token === null) return;
    try {
      const [b, u, a, l, g] = await Promise.all([
        api.adminBusinesses(token, null),
        api.adminUsers(token, null),
        api.adminAdministrators(token),
        api.adminAllowlist(token),
        api.adminAudit(token),
      ]);
      setBusinesses(b);
      setUsers(u);
      setAdministrators(a);
      setAllowlist(l);
      setAudit(g);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpenBusiness(null);
      setOpenUser(null);
      setNewAllowed(null);
      setEditReason("");
      setPaymentAmount("");
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;

  if (token === null || user === null || !user.isAdministrator) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} title={copy.platformAdmin} />
        <main style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <Empty
            title={copy.platformAdmin}
            body={copy.allowlistNote}
            action={<Button onClick={() => router.push("/signin")}>{copy.platformAdmin}</Button>}
          />
        </main>
      </>
    );
  }

  const needle = query.trim().toLowerCase();
  const shownUsers = needle === ""
    ? users
    : users.filter((candidate) => candidate.name.toLowerCase().includes(needle) || candidate.phone.includes(needle));

  return (
    <>
      <AppHeader languageLabel={copy.langSwitch} title={copy.platformAdmin} />

      <main className="scroll" style={{ flex: 1, minHeight: 0, padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Every screen here runs over a connection that bypasses tenant
            isolation. Saying so is part of the control, not decoration. */}
        <Warning>{copy.bypassNote}</Warning>

        {error !== null && <Critical>{error}</Critical>}

        {tab === "businesses" &&
          businesses.map((summary) => (
            <button key={summary.business.id} style={{ textAlign: "start" }}
              onClick={() => {
                setOpenBusiness(summary);
                void api.adminSubscription(token, summary.business.id).then(setBilling).catch(() => setBilling(null));
              }}>
              <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{summary.business.name}</span>
                  <span className="hint">
                    {copy.owner}: {summary.ownerName ?? "—"}
                  </span>
                </span>
                <StateTag
                  active={summary.business.active}
                  state={summary.subscriptionState}
                  labels={{ active: copy.active, inactive: copy.inactive, overdue: copy.overdue }}
                />
              </Card>
            </button>
          ))}

        {tab === "users" && (
          <>
            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.searchUser} aria-label={copy.searchUser} />
            {/* Authorization is a Membership, not a property of the person. */}
            <Note>{copy.roleNote}</Note>
            {shownUsers.map((candidate) => (
              <button key={candidate.id} style={{ textAlign: "start" }}
                onClick={() =>
                  api.adminUserRecord(token, candidate.id).then(setOpenUser).catch((cause) =>
                    setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")))
                }>
                <Card style={{ width: "100%", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{candidate.name}</span>
                    <span className="hint tab" dir="ltr">{candidate.phone}</span>
                  </span>
                  {candidate.deleted && <span className="hint">{copy.deleted}</span>}
                  {candidate.isAdministrator && <span className="hint">{copy.admin}</span>}
                </Card>
              </button>
            ))}
          </>
        )}

        {tab === "system" && (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              {(["admins", "allowlist", "audit"] as const).map((panel) => (
                <button key={panel} className="chip" onClick={() => setSystemPanel(panel)}
                  aria-pressed={systemPanel === panel}
                  style={{
                    flex: 1,
                    background: systemPanel === panel ? "var(--accent-soft)" : "transparent",
                    color: systemPanel === panel ? "var(--accent-strong)" : "var(--muted)",
                    border: `1px solid ${systemPanel === panel ? "var(--accent)" : "var(--line)"}`,
                  }}>
                  {panel === "admins" ? copy.admins : panel === "allowlist" ? copy.allowlist : copy.audit}
                </button>
              ))}
            </div>

            {systemPanel === "admins" && (
              <>
                <Note>{copy.adminsNote}</Note>
                <Note>{copy.seededNote}</Note>
                {administrators.map((candidate) => (
                  <Card key={candidate.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1 }}>{candidate.name}</span>
                    <span className="hint tab" dir="ltr">{candidate.phone}</span>
                    {candidate.id !== user.id && (
                      <button onClick={() => act(() => api.adminSetAdministrator(token, candidate.id, false))}
                        style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}>
                        {copy.revoke}
                      </button>
                    )}
                  </Card>
                ))}
              </>
            )}

            {systemPanel === "allowlist" && (
              <>
                {/* ADR 0010's second, independent condition. */}
                <Note>{copy.allowlistNote}</Note>
                <Warning>{copy.allowlistWarn}</Warning>
                {allowlist.map((entry) => (
                  <Card key={entry.phone} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="tab" style={{ flex: 1 }} dir="ltr">{entry.phone}</span>
                    <span className="hint">{entry.note ?? ""}</span>
                    <button onClick={() => act(() => api.adminRemoveFromAllowlist(token, entry.phone))}
                      style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}>
                      {copy.delete}
                    </button>
                  </Card>
                ))}
                <Button intent="quiet" onClick={() => setNewAllowed("+972")}>{copy.add}</Button>
              </>
            )}

            {systemPanel === "audit" && (
              <>
                <Note>{copy.auditNote}</Note>
                <Note>{copy.auditAppendOnly}</Note>
                {audit.map((entry) => (
                  <Card key={entry.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontWeight: 500, fontSize: 13.5 }}>{entry.action}</span>
                    <span className="hint">
                      {entry.entityType} · {new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
                      }).format(new Date(entry.occurredAt))}
                    </span>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </main>

      <BottomNav
        current={tab}
        onSelect={(id) => setTab(id as Tab)}
        items={[
          { id: "businesses", label: copy.businesses, icon: <BuildingIcon /> },
          { id: "users", label: copy.users, icon: <PeopleIcon /> },
          { id: "system", label: copy.system, icon: <ShieldIcon /> },
        ]}
      />

      <Sheet open={openBusiness !== null} onClose={() => setOpenBusiness(null)}>
        {openBusiness !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 20 }}>{openBusiness.business.name}</h2>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row label={copy.owner} value={openBusiness.ownerName ?? "—"} />
              <Row label={copy.phone} value={openBusiness.business.phone} />
              {billing !== null && (
                <>
                  <Row label={copy.plan} value={billing.subscription.plan} />
                  <Row label={copy.paidThrough} value={formatLocalDate(billing.subscription.paidThrough, language)} />
                </>
              )}
            </Card>

            <span className="label">{copy.recordPayment}</span>
            <Note>{copy.paymentNote}</Note>
            <Field id="payment-amount" label={copy.amount} type="number" value={paymentAmount}
              placeholder={copy.paymentNotePlaceholder}
              onChange={(e) => setPaymentAmount(e.target.value)} />
            <Button busy={busy} disabled={paymentAmount.trim() === ""}
              onClick={() =>
                act(() =>
                  api.adminRecordPayment(token, openBusiness.business.id, {
                    amountMinor: Math.round(Number(paymentAmount) * MINOR_UNITS_PER_MAJOR),
                    paidOn: new Date().toISOString().slice(0, 10),
                    note: null,
                  }),
                )
              }>
              {copy.recordPayment}
            </Button>

            <span className="label">{copy.editOnBehalf}</span>
            <Note>{copy.editOnBehalfHint}</Note>
            {/* No impersonation: the edit is recorded against the administrator
                who made it, with the reason they gave. */}
            <Warning>{copy.editAudited}</Warning>
            <Field id="edit-reason" label={copy.editReason} placeholder={copy.editReasonPlaceholder}
              hint={copy.editReasonHint} value={editReason} onChange={(e) => setEditReason(e.target.value)} />

            <Note>{copy.deactivateNote}</Note>
            <Button
              intent={openBusiness.business.active ? "danger" : "primary"}
              busy={busy}
              onClick={() =>
                act(() => api.adminSetBusinessActive(token, openBusiness.business.id, !openBusiness.business.active))
              }>
              {openBusiness.business.active ? copy.deactivate : copy.reactivate}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={openUser !== null} onClose={() => setOpenUser(null)}>
        {openUser !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 20 }}>{openUser.user.name}</h2>
            <span className="hint tab" dir="ltr">{openUser.user.phone}</span>
            {/* ADR 0006: opening this card was itself written to the trail. */}
            <Warning>{copy.readAudited}</Warning>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row label={copy.registered} value={formatLocalDate(openUser.user.createdAt.slice(0, 10), language)} />
              <Row label={copy.appointmentCount} value={String(openUser.appointments.length)} />
              <Row label={copy.status} value={openUser.user.deleted ? copy.deleted : copy.active} />
            </Card>
            <Note>{copy.deactivateUserNote}</Note>
            <Button
              intent={openUser.user.deleted ? "primary" : "danger"}
              busy={busy}
              onClick={() => act(() => api.adminSetUserActive(token, openUser.user.id, openUser.user.deleted))}>
              {openUser.user.deleted ? copy.reactivateUser : copy.deactivateUser}
            </Button>
            <Button intent="quiet" busy={busy}
              onClick={() => act(() => api.adminSetAdministrator(token, openUser.user.id, !openUser.user.isAdministrator))}>
              {openUser.user.isAdministrator ? copy.revoke : copy.grant}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={newAllowed !== null} onClose={() => setNewAllowed(null)}>
        {newAllowed !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{copy.allowlist}</h2>
            <Field id="allow-phone" label={copy.phone} dir="ltr" value={newAllowed}
              onChange={(e) => setNewAllowed(e.target.value)} />
            <Button busy={busy} onClick={() => act(() => api.adminAddToAllowlist(token, newAllowed.trim(), null))}>
              {copy.add}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", gap: 10 }}>
    <span className="label" style={{ flex: 1 }}>{label}</span>
    <span style={{ fontSize: 14.5, fontWeight: 500 }}>{value}</span>
  </div>
);

const StateTag = ({
  active,
  state,
  labels,
}: {
  active: boolean;
  state: SubscriptionState | null;
  labels: { active: string; inactive: string; overdue: string };
}) => {
  const tone = !active ? "critical" : state === "IN_GRACE" || state === "LAPSED" ? "caution" : "positive";
  const text = !active ? labels.inactive : state === "CURRENT" || state === null ? labels.active : labels.overdue;
  return (
    <span style={{ fontSize: 11.5, padding: "4px 9px", borderRadius: 999, background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>
      {text}
    </span>
  );
};
