"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import {
  NO_DIRECTORY_FILTER,
  type AllowlistEntryDto,
  type AppointmentDto,
  type AuditEntryDto,
  type BillingDto,
  type BillingStatus,
  type DirectoryFilter,
  type DirectoryRowDto,
  type PaymentBoardDto,
  type PlatformStatsDto,
  type UserDto,
} from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { TEXT_RULES } from "@tor-now/domain";
import { useSession } from "@/lib/session.tsx";
import { usePlans } from "@/lib/use-plans.ts";
import { useFieldProblem } from "@/lib/use-field-problem.ts";
import { checkLocalPhone, fromE164, toE164 } from "@/lib/phone.ts";
import { PhoneField } from "@/components/phone-field.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import { SignOutButton } from "@/components/sign-out.tsx";
import { BottomNav, BuildingIcon, ChartIcon, PeopleIcon, ShieldIcon, TagIcon } from "@/components/bottom-nav.tsx";
import { FeaturesCard } from "@/components/admin/features-card.tsx";
import { AddonsSection } from "@/components/owner/addons-section.tsx";
import { PaymentLines } from "@/components/payment-lines.tsx";
import { paymentBoardOf } from "@/lib/next-payment.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { CatalogueTab, type CataloguePart } from "@/components/admin/catalogue-tab.tsx";
import type { CostPart } from "@/components/admin/costs/costs-part.tsx";
import { FairUseBanner } from "@/components/admin/costs/fair-use-banner.tsx";
import { UsageCard } from "@/components/admin/costs/usage-card.tsx";
import { costApi } from "@/lib/api/cost-client.ts";
import { localDateOf } from "@/components/owner/day-filter.ts";
import { Button, Card, Critical, Empty, Field, Note, Sheet, Spinner, Warning } from "@/components/ui.tsx";
import { AdminStats } from "@/components/admin-stats.tsx";
import { BusinessDirectory } from "@/components/admin/business-directory.tsx";
import { PlanChangeCard } from "@/components/admin/plan-change-card.tsx";
import { CalendarKeeper } from "@/components/admin/calendar-keeper.tsx";
import { NextDate, PlanBadge, StatusBadge } from "@/components/billing-badges.tsx";

type Tab = "businesses" | "users" | "catalogue" | "stats" | "system";
type SystemPanel = "admins" | "allowlist" | "audit";

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * ADR 0010's scope, and nothing beyond it. Impersonation is absent by design:
 * no screen here can act as another User, because an impersonated action would
 * record the wrong actor and make every dispute unresolvable.
 */
export default function AdminPage() {
  const copy = useCopy("admin");
  const billingCopy = useCopy("billing");
  const catalogueCopy = useCopy("catalogue");
  const erasureCopy = useCopy("erasure");
  const router = useRouter();
  const { language } = useLanguage();
  const { token, user, loading } = useSession();
  const errorText = useErrorText();

  const [tab, setTab] = useState<Tab>("businesses");
  const [systemPanel, setSystemPanel] = useState<SystemPanel>("admins");
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>(NO_DIRECTORY_FILTER);
  const [directoryRefresh, setDirectoryRefresh] = useState(0);
  const plans = usePlans();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [administrators, setAdministrators] = useState<UserDto[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntryDto[]>([]);
  const [audit, setAudit] = useState<AuditEntryDto[]>([]);
  const [stats, setStats] = useState<PlatformStatsDto | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const problem = useFieldProblem();
  const [openBusiness, setOpenBusiness] = useState<DirectoryRowDto | null>(null);
  // Where the Catalogue opens; `at` remounts it when a banner sends the administrator there again.
  const [catalogueStart, setCatalogueStart] = useState<{ part: CataloguePart; costs?: CostPart; at: number }>({
    part: "plans",
    at: 0,
  });
  const [billing, setBilling] = useState<BillingDto | null>(null);
  const [editReason, setEditReason] = useState("");
  const [edits, setEdits] = useState<{
    name: string;
    phone: string;
    address: string;
    description: string;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [openUser, setOpenUser] = useState<{ user: UserDto; appointments: AppointmentDto[] } | null>(null);
  const [newAllowed, setNewAllowed] = useState<string | null>(null);
  const [erasing, setErasing] = useState<{ userId: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    if (token === null) return;
    try {
      const [u, a, l, g, s] = await Promise.all([
        api.adminUsers(token, null),
        api.adminAdministrators(token),
        api.adminAllowlist(token),
        api.adminAudit(token),
        api.adminStats(token),
      ]);
      setUsers(u);
      setAdministrators(a);
      setAllowlist(l);
      setAudit(g);
      setStats(s);
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
      setDirectoryRefresh((count) => count + 1);
      await load();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const board = billing === null ? null : paymentBoardOf(billing);

  /**
   * A Business's billing, and the payment to record prefilled with what its
   * next payment comes to, as the owner was told: the Plan, the Add-ons, and
   * any days owed. The administrator may change it.
   */
  const showBilling = (loaded: BillingDto) => {
    setBilling(loaded);
    if (loaded.nextPayment !== undefined) setPaymentAmount(String(loaded.nextPayment.totalMinor / MINOR_UNITS_PER_MAJOR));
  };

  /** The next payment line by line, as the amount field's hint says it. */
  const breakdownOf = (payment: PaymentBoardDto["nextPayment"]): string => {
    const money = (minor: number) => formatPrice(minor, language, "—");
    const shortDate = (date: string) => formatLocalDate(date, language, { day: "numeric", month: "numeric" });
    const lines = payment.lines.map((line) =>
      line.kind === "PLAN"
        ? `${billingCopy.plan[line.plan]} ${money(line.amountMinor)}`
        : line.kind === "ADDON"
          ? `${billingCopy.featureName[line.feature]} ${money(line.amountMinor)}`
          : fillText(billingCopy.lineDays, {
              owed: money(line.amountMinor),
              from: shortDate(line.owed.from),
              through: shortDate(line.owed.through),
            }),
    );
    return fillText(catalogueCopy.paymentBreakdown, { lines: lines.join(" + ") });
  };

  if (loading) return <Spinner page />;

  if (token === null || user === null || !user.isAdministrator) {
    return (
      <>
        <AppHeader title={copy.platformAdmin} />
        <main style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <Empty
            title={copy.platformAdmin}
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

  const openRow = (row: DirectoryRowDto) => {
    setOpenBusiness(row);
    setEdits({
      name: row.business.name,
      phone: row.business.phone,
      address: row.business.address ?? "",
      description: row.business.description ?? "",
    });
    setBilling(null);
    setPaymentAmount("");
    void api
      .adminSubscription(token, row.business.id)
      .then(showBilling)
      .catch(() => setBilling(null));
  };

  /** A Business's sheet from anywhere that knows only its id — a cost screen, say. */
  const openBusinessById = (businessId: string) => {
    setError(null);
    void costApi
      .businessRow(token, businessId)
      .then(openRow)
      .catch((cause: unknown) => setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
  };

  const showStatus = (status: BillingStatus) => {
    setDirectoryFilter({ ...NO_DIRECTORY_FILTER, statuses: [status] });
    setTab("businesses");
  };

  return (
    <>
      <AppHeader
        title={copy.platformAdmin}
        trailing={
          <AccountButton
            initial={user.name.trim().charAt(0) || "?"}
            onClick={() => setDrawerOpen(true)}
            label={copy.account}
          />
        }
      />

      <main className="scroll" style={{ flex: 1, minHeight: 0, padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        {error !== null && <Critical>{error}</Critical>}

        {tab === "businesses" && (
          <>
          <FairUseBanner
            token={token}
            onOpen={() => {
              setCatalogueStart({ part: "costs", costs: "fairUse", at: Date.now() });
              setTab("catalogue");
            }}
          />
          <BusinessDirectory
            token={token}
            filter={directoryFilter}
            onFilterChange={setDirectoryFilter}
            onOpen={openRow}
            refreshKey={directoryRefresh}
          />
          </>
        )}

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

        {tab === "stats" && (
          stats === null
            ? <Spinner />
            : (
              <AdminStats
                stats={stats}
                language={language}
                onShowStatus={showStatus}
                copy={{
                  totalUsers: copy.totalUsers,
                  totalUsersHint: copy.totalUsersHint,
                  businessStatus: copy.businessStatus,
                  planMix: copy.planMix,
                  planMixHint: copy.planMixHint,
                  signups: copy.signups,
                  signupsHint: copy.signupsHint,
                  businesses: copy.businesses,
                  users: copy.users,
                  appointmentActivity: copy.appointmentActivity,
                  appointmentActivityHint: copy.appointmentActivityHint,
                  confirmed: copy.confirmed,
                  cancelled: copy.cancelled,
                  noShow: copy.noShow,
                  completed: copy.completed,
                  topBusinesses: copy.topBusinesses,
                  topBusinessesHint: copy.topBusinessesHint,
                  noData: copy.noData,
                }}
              />
            )
        )}

        {tab === "catalogue" && (
          <CatalogueTab
            key={catalogueStart.at}
            token={token}
            initial={catalogueStart}
            onShowBusinesses={(filter) => {
              setDirectoryFilter({ ...NO_DIRECTORY_FILTER, ...filter });
              setTab("businesses");
            }}
            onOpenBusiness={openBusinessById}
          />
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
                <Button intent="quiet" onClick={() => setNewAllowed("")}>{copy.add}</Button>
              </>
            )}

            {systemPanel === "audit" && (
              <>
                <Note>{copy.auditNote}</Note>
                {/* The log's worth is that it cannot be edited, and saying so
                    is part of the control rather than decoration — an
                    administrator reading it needs to know nobody tidied it.
                    Lost when the system tab was split into panels. */}
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
        onSelect={(id) => {
          // The navigation opens the Catalogue where it always has; only a banner opens it elsewhere.
          if (id === "catalogue") setCatalogueStart({ part: "plans", at: Date.now() });
          setTab(id as Tab);
        }}
        items={[
          { id: "businesses", label: copy.businesses, icon: <BuildingIcon /> },
          { id: "users", label: copy.users, icon: <PeopleIcon /> },
          { id: "catalogue", label: catalogueCopy.tab, icon: <TagIcon /> },
          { id: "stats", label: copy.stats, icon: <ChartIcon /> },
          { id: "system", label: copy.system, icon: <ShieldIcon /> },
        ]}
      />

      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} labelledBy="admin-drawer-title">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="admin-drawer-title" style={{ fontSize: 19 }}>{copy.usingAs}</h2>
          <Card style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 600 }}>{copy.platformAdmin}</span>
            <span className="hint" dir="ltr">{user.phone}</span>
          </Card>
          <Button intent="quiet" onClick={() => router.push("/")}>{copy.asCustomer}</Button>
          <SignOutButton label={copy.signOut} />
        </div>
      </Sheet>

      <Sheet open={openBusiness !== null} onClose={() => setOpenBusiness(null)}>
        {openBusiness !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 20 }}>{openBusiness.business.name}</h2>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Row label={copy.owner} value={openBusiness.ownerName ?? "—"} />
              <Row label={copy.phone} value={openBusiness.business.phone} />
              {billing !== null && (
                <>
                  <Row label={copy.plan}>
                    <PlanBadge plan={billing.subscription.plan} version={billing.subscription.planVersion} />
                  </Row>
                  <Row label={copy.status}>
                    <StatusBadge status={billing.status} />
                  </Row>
                  <Row label={billingCopy.dateLabel[billing.status]}>
                    <NextDate status={billing.status} date={billing.nextDate} timeZone={openBusiness.business.timeZone} />
                  </Row>
                  {board !== null && <PaymentLines payment={board.nextPayment} />}
                </>
              )}
            </Card>

            <UsageCard key={`usage-${openBusiness.business.id}`} token={token} businessId={openBusiness.business.id} />

            {billing?.features !== undefined && (
              <FeaturesCard
                key={`features-${openBusiness.business.id}`}
                token={token}
                businessId={openBusiness.business.id}
                businessName={openBusiness.business.name}
                features={billing.features}
                addons={board?.addons ?? []}
                plans={plans}
                today={localDateOf(new Date().toISOString(), openBusiness.business.timeZone)}
                onChanged={(features) => setBilling((current) => (current === null ? current : { ...current, features }))}
              />
            )}

            {board !== null && (
              // ADR 0021: for an owner who phones in, by the owner's own rules.
              <AddonsSection
                board={board}
                onAdd={async (feature) => showBilling(await api.adminAddAddon(token, openBusiness.business.id, feature))}
                onCancel={async (feature) => showBilling(await api.adminCancelAddon(token, openBusiness.business.id, feature))}
              />
            )}

            <CalendarKeeper
              key={openBusiness.business.id}
              token={token}
              businessId={openBusiness.business.id}
              onSettled={() => setDirectoryRefresh((count) => count + 1)}
            />

            <span className="label">{copy.recordPayment}</span>
            <Field id="payment-amount" label={copy.amount} type="number" value={paymentAmount}
              placeholder={copy.paymentNotePlaceholder}
              {...(board === null ? {} : { hint: breakdownOf(board.nextPayment) })}
              onChange={(e) => setPaymentAmount(e.target.value)} />
            <Button busy={busy} disabled={paymentAmount.trim() === ""}
              onClick={() =>
                act(() =>
                  api.adminRecordPayment(token, openBusiness.business.id, {
                    amountMinor: Math.round(Number(paymentAmount) * MINOR_UNITS_PER_MAJOR),
                    // The Business's own day: in Israel's small hours UTC is still yesterday.
                    paidOn: localDateOf(new Date().toISOString(), openBusiness.business.timeZone),
                    note: null,
                  }),
                )
              }>
              {copy.recordPayment}
            </Button>

            {billing !== null && plans.length > 0 && (
              <>
                <span className="label">{copy.moveTo}</span>
                <PlanChangeCard
                  key={`${billing.subscription.plan}-${billing.subscription.scheduledMove?.plan ?? ""}`}
                  billing={billing}
                  plans={plans}
                  busy={busy}
                  onMove={(plan) => void act(() => api.adminChangePlan(token, openBusiness.business.id, plan))}
                />
              </>
            )}

            <span className="label">{copy.editOnBehalf}</span>
            {edits !== null && (
              <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field id="edit-name" label={copy.fName} value={edits.name}
                  problem={problem.text(edits.name, TEXT_RULES.businessName)}
                  onChange={(event) => setEdits({ ...edits, name: event.target.value })} />
                <PhoneField id="edit-phone" label={copy.fPhone} value={fromE164(edits.phone)}
                  onChange={(local) => setEdits({ ...edits, phone: toE164(local) })} />
                <Field id="edit-address" label={copy.fAddress} value={edits.address}
                  problem={problem.text(edits.address, TEXT_RULES.address)}
                  onChange={(event) => setEdits({ ...edits, address: event.target.value })} />
                <Field id="edit-description" label={copy.fDescription} value={edits.description}
                  problem={problem.text(edits.description, TEXT_RULES.description)}
                  onChange={(event) => setEdits({ ...edits, description: event.target.value })} />
                <Field id="edit-reason" label={copy.editReason} placeholder={copy.editReasonPlaceholder}
                  hint={copy.editReasonHint} value={editReason}
                  problem={problem.text(editReason, TEXT_RULES.auditReason, editReason !== "")}
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
              problem={problem.text(erasing.reason, TEXT_RULES.auditReason, erasing.reason !== "")}
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
            <PhoneField id="allow-phone" label={copy.phone} value={newAllowed}
              showProblem={newAllowed !== ""}
              onChange={setNewAllowed} />
            <Button busy={busy}
              disabled={checkLocalPhone(newAllowed) !== null}
              onClick={() => act(() => api.adminAddToAllowlist(token, toE164(newAllowed), null))}>
              {copy.add}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

const Row = ({ label, value, children }: { label: string; value?: string; children?: ReactNode }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 26 }}>
    <span className="label" style={{ flex: 1 }}>{label}</span>
    <span style={{ fontSize: 14.5, fontWeight: 500 }}>{children ?? value}</span>
  </div>
);
