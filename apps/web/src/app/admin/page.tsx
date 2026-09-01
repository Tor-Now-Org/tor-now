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
  const erasureCopy = useCopy("erasure");
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
  const [edits, setEdits] = useState<{
    name: string;
    phone: string;
    address: string;
    description: string;
  } | null>(null);
  const [plan, setPlan] = useState<{ plan: "FREE" | "STANDARD"; amount: string; billingPeriod: "MONTHLY" | "YEARLY" } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [openUser, setOpenUser] = useState<{ user: UserDto; appointments: AppointmentDto[] } | null>(null);
  const [newAllowed, setNewAllowed] = useState<string | null>(null);
  const [erasing, setErasing] = useState<{ userId: string; reason: string } | null>(null);

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
      setErasing(null);
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
                setEdits({
                  name: summary.business.name,
                  phone: summary.business.phone,
                  address: summary.business.address ?? "",
                  description: summary.business.description ?? "",
                });
                setPlan(
                  summary.subscription === null
                    ? null
                    : {
                        plan: summary.subscription.plan,
                        amount: String(summary.subscription.amount),
                        billingPeriod: summary.subscription.billingPeriod,
                      },
                );
                void api
                  .adminSubscription(token, summary.business.id)
                  .then(setBilling)
                  .catch(() => setBilling(null));
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

            <span className="label">{copy.plan}</span>
            {plan !== null && (
              <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["FREE", "STANDARD"] as const).map((candidate) => (
                    <button
                      key={candidate}
                      className="chip"
                      aria-pressed={plan.plan === candidate}
                      onClick={() => setPlan({ ...plan, plan: candidate })}
                      style={{
                        flex: 1,
                        background: plan.plan === candidate ? "var(--accent)" : "var(--raised)",
                        color: plan.plan === candidate ? "var(--on-accent)" : "var(--ink)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["MONTHLY", "YEARLY"] as const).map((candidate) => (
                    <button
                      key={candidate}
                      className="chip"
                      aria-pressed={plan.billingPeriod === candidate}
                      onClick={() => setPlan({ ...plan, billingPeriod: candidate })}
                      style={{
                        flex: 1,
                        background: plan.billingPeriod === candidate ? "var(--accent-soft)" : "var(--raised)",
                        color: plan.billingPeriod === candidate ? "var(--accent-strong)" : "var(--muted)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
                <Field
                  id="plan-amount"
                  label={copy.amount}
                  type="number"
                  value={plan.amount}
                  onChange={(event) => setPlan({ ...plan, amount: event.target.value })}
                />
                <Button
                  intent="quiet"
                  busy={busy}
                  onClick={() =>
                    act(() =>
                      api.adminUpdateSubscription(token, openBusiness.business.id, {
                        plan: plan.plan,
                        billingPeriod: plan.billingPeriod,
                        amountMinor: Math.round(Number(plan.amount) * MINOR_UNITS_PER_MAJOR),
                      }),
                    )
                  }
                >
                  {copy.save}
                </Button>
              </Card>
            )}

            <span className="label">{copy.editOnBehalf}</span>
            <Note>{copy.editOnBehalfHint}</Note>
            {/* No impersonation: the edit is recorded against the administrator
                who made it, with the reason they gave. */}
            <Warning>{copy.editAudited}</Warning>
            {edits !== null && (
              <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field id="edit-name" label={copy.fName} value={edits.name}
                  onChange={(event) => setEdits({ ...edits, name: event.target.value })} />
                <Field id="edit-phone" label={copy.fPhone} dir="ltr" value={edits.phone}
                  onChange={(event) => setEdits({ ...edits, phone: event.target.value })} />
                <Field id="edit-address" label={copy.fAddress} value={edits.address}
                  onChange={(event) => setEdits({ ...edits, address: event.target.value })} />
                <Field id="edit-description" label={copy.fDescription} value={edits.description}
                  onChange={(event) => setEdits({ ...edits, description: event.target.value })} />
                <Field id="edit-reason" label={copy.editReason} placeholder={copy.editReasonPlaceholder}
                  hint={copy.editReasonHint} value={editReason}
                  onChange={(event) => setEditReason(event.target.value)} />
                <Button
                  busy={busy}
                  // The reason is not optional: it is what the trail records
                  // alongside the change, and what makes the edit answerable.
                  disabled={editReason.trim().length < 3}
                  onClick={() =>
                    act(() =>
                      api.adminUpdateBusiness(
                        token,
                        openBusiness.business.id,
                        {
                          name: edits.name,
                          phone: edits.phone,
                          address: edits.address === "" ? null : edits.address,
                          description: edits.description === "" ? null : edits.description,
                        },
                        editReason.trim(),
                      ),
                    )
                  }
                >
                  {copy.save}
                </Button>
              </Card>
            )}

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

            {/* ADR 0008's erasure sits below a rule, apart from the reversible
                actions above it, because it is not one of them. */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="label">{erasureCopy.title}</span>
              <span className="hint">{erasureCopy.hint}</span>
              {openUser.user.anonymised ? (
                <Note>{erasureCopy.already}</Note>
              ) : (
                <Button
                  intent="danger"
                  onClick={() => setErasing({ userId: openUser.user.id, reason: "" })}
                >
                  {erasureCopy.title}
                </Button>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={erasing !== null} onClose={() => setErasing(null)}>
        {erasing !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 20 }}>{erasureCopy.title}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">{erasureCopy.what}</span>
              <span className="hint">{erasureCopy.p1}</span>
              <span className="hint">{erasureCopy.p2}</span>
              <span className="hint">{erasureCopy.p3}</span>
            </div>
            <Critical>{erasureCopy.irreversible}</Critical>
            <Field
              id="erase-reason"
              label={erasureCopy.reason}
              placeholder={erasureCopy.reasonPlaceholder}
              hint={erasureCopy.reasonHint}
              value={erasing.reason}
              onChange={(event) => setErasing({ ...erasing, reason: event.target.value })}
            />
            <Button
              intent="danger"
              busy={busy}
              disabled={erasing.reason.trim().length < 3}
              onClick={() =>
                act(() => api.adminAnonymiseUser(token, erasing.userId, erasing.reason.trim()))
              }
            >
              {erasureCopy.confirm}
            </Button>
            <Button intent="quiet" onClick={() => setErasing(null)}>
              {erasureCopy.cancel}
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
