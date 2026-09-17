"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto, ResourceDto } from "@/lib/api/types.ts";
import { graceDaysLeft } from "@/lib/billing-alert.ts";
import { staffRole } from "@/lib/roles.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import {
  BottomNav,
  BuildingIcon,
  CalendarIcon,
  ClockIcon,
  PeopleIcon,
} from "@/components/bottom-nav.tsx";
import { BusinessPanel } from "@/components/owner/business-panel.tsx";
import { CalendarDay } from "@/components/owner/calendar-day.tsx";
import { Customers } from "@/components/owner/customers.tsx";
import { Schedule } from "@/components/owner/schedule.tsx";
import { AccountDrawer } from "@/components/account-drawer.tsx";
import { Button, Empty, Sheet, Spinner } from "@/components/ui.tsx";
import { fillParts } from "@/lib/i18n/fill.ts";

const TABS = ["day", "schedule", "business", "customers"] as const;
type Tab = (typeof TABS)[number];

/**
 * The owner application. The same person, the same sign-in — only the context
 * differs, which is why the drawer offers a way back to the customer app rather
 * than a sign-out.
 */
function ManageApp() {
  const copy = useCopy("owner");
  const router = useRouter();
  const params = useSearchParams();
  const { token, user, loading } = useSession();

  /**
   * The tab is in the URL so a screen can send the owner back to the one they
   * came from. Returning somebody to a different screen than the one they left
   * is its own small betrayal, and the customer page leaves from the list.
   */
  const requestedTab = params.get("tab");
  /** The calendar the schedule should open on, when arriving from the panel. */
  const [editingCalendar, setEditingCalendar] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() =>
    TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : "day",
  );
  const [businesses, setBusinesses] = useState<BusinessDto[] | null>(null);
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const requested = params.get("business");

  const loadBusinesses = useCallback(async () => {
    if (token === null) return;
    const mine = await api.myBusinesses(token);
    setBusinesses(mine);
    const chosen = mine.find((candidate) => candidate.id === requested) ?? mine[0] ?? null;
    setBusiness(chosen);
  }, [token, requested]);

  useEffect(() => {
    void loadBusinesses();
  }, [loadBusinesses]);

  const loadResources = useCallback(async () => {
    if (token === null || business === null || !business.active) return;
    const all = await api.listResources(token, business.id);
    // A WORKER is on some of the calendars, not all of them, and every screen
    // here is fed from this one list — so the narrowing belongs here rather
    // than in each of them (ADR 0016).
    setResources(
      business.role === "WORKER"
        ? all.filter((resource) => (business.resourceIds ?? []).includes(resource.id))
        : all,
    );
  }, [token, business]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  /** Days left in the Grace Period, shown once per app open. Billing is the
   * OWNER's alone (ADR 0016) — the same rule the billing panel applies. */
  const [graceDays, setGraceDays] = useState<number | null>(null);

  const loadGraceAlert = useCallback(async () => {
    if (token === null || business === null || !business.active) return setGraceDays(null);
    if ((business.role ?? "OWNER") !== "OWNER") return setGraceDays(null);
    try {
      const billing = await api.subscription(token, business.id);
      setGraceDays(
        billing.state === "IN_GRACE"
          ? graceDaysLeft(billing.subscription.paidThrough, business.timeZone)
          : null,
      );
    } catch {
      // A reminder is a courtesy, not a gate — a failed read shows nothing
      // rather than breaking the app the owner came here to use.
      setGraceDays(null);
    }
  }, [token, business]);

  useEffect(() => {
    void loadGraceAlert();
  }, [loadGraceAlert]);

  if (loading || (token !== null && businesses === null)) return <Spinner />;

  if (token === null) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} title={copy.manage} />
        <main style={{ flex: 1, padding: 24 }}>
          <Empty
            title={copy.usingAs}
            body={copy.oneIdentity}
            action={<Button onClick={() => router.push("/signin")}>{copy.manage}</Button>}
          />
        </main>
      </>
    );
  }

  if (business === null) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} title={copy.manage} />
        <main style={{ flex: 1, padding: 24 }}>
          <Empty
            title={copy.usingAs}
            body={copy.oneIdentity}
            action={<Button onClick={() => router.push("/onboarding")}>{copy.manage}</Button>}
          />
        </main>
      </>
    );
  }

  if (!business.active) {
    return (
      <>
        <AppHeader languageLabel={copy.langSwitch} title={business.name} />
        <main style={{ flex: 1, padding: 24 }} />
        <Sheet open onClose={() => router.push("/")} labelledBy="inactive-title">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="inactive-title" style={{ fontSize: 19 }}>{copy.businessInactiveTitle}</h2>
            <p style={{ margin: 0 }}>{copy.businessInactiveBody}</p>
            <Button onClick={() => router.push("/")}>{copy.asCustomer}</Button>
          </div>
        </Sheet>
      </>
    );
  }

  // Absent means an API deployed before roles existed, where anybody staffing
  // was an owner (ADR 0016).
  const manages = (business.role ?? "OWNER") !== "WORKER";
  // A WORKER reaching a tab they may not have — an old link, a role changed
  // under them — sees their calendar rather than an empty screen.
  const shown: Tab = manages || tab === "day" || tab === "schedule" ? tab : "day";

  return (
    <>
      <AppHeader
        languageLabel={copy.langSwitch}
        title={business.name}
        // The chevron is the way back to the customer app; the drawer offers the
        // same trip, but only after you think to open it.
        onBack={() => router.push("/")}
        backLabel={copy.asCustomer}
        showBackLabel={false}
        trailing={
          user !== null ? (
            <AccountButton
              initial={user.name.trim().charAt(0) || "?"}
              onClick={() => setDrawerOpen(true)}
              label={copy.account}
            />
          ) : undefined
        }
      />

      <main className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {shown === "day" && (
          <CalendarDay token={token} business={business} resources={resources} />
        )}
        {shown === "schedule" && (
          <Schedule
            token={token}
            business={business}
            resources={resources}
            {...(editingCalendar === null ? {} : { openOn: editingCalendar })}
          />
        )}
        {shown === "business" && (
          <BusinessPanel
            token={token}
            business={business}
            resources={resources}
            // Editing a calendar means its schedule, so the tab changes with it.
            onEditCalendar={(resourceId) => {
              setEditingCalendar(resourceId);
              setTab("schedule");
            }}
            // Reloading the businesses replaces the chosen one, and the
            // resources effect is keyed on it — so asking for both after a
            // calendar changed fetched the calendars twice and the businesses
            // for no reason.
            onChanged={(touches) => {
              if (touches === "everything") void loadBusinesses();
              void loadResources();
            }}
            // They may have just changed their own terms, and the tabs and the
            // calendars they may see both hang off that.
            onTeamChanged={() => void loadBusinesses()}
          />
        )}
        {shown === "customers" && <Customers token={token} business={business} />}
      </main>

      <BottomNav
        current={shown}
        onSelect={(id) => {
          setEditingCalendar(null);
          setTab(id as Tab);
        }}
        items={[
          { id: "day", label: copy.tabDay, icon: <CalendarIcon /> },
          { id: "schedule", label: copy.tabSchedule, icon: <ClockIcon /> },
          ...(manages
            ? [
                { id: "business", label: copy.tabBusiness, icon: <BuildingIcon /> },
                { id: "customers", label: copy.tabCustomers, icon: <PeopleIcon /> },
              ]
            : []),
        ]}
      />

      <Sheet open={graceDays !== null} onClose={() => setGraceDays(null)} labelledBy="grace-alert-title">
        {graceDays !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="grace-alert-title" style={{ fontSize: 19 }}>{copy.graceAlertTitle}</h2>
            <p style={{ margin: 0 }}>
              {fillParts(copy.billingOverdue, { days: String(graceDays) }).map((part) => part.text)}
            </p>
            <Button onClick={() => setGraceDays(null)}>{copy.graceAlertClose}</Button>
          </div>
        )}
      </Sheet>

      <AccountDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        {...(user === null ? {} : { userName: user.name })}
        labels={{ usingAs: copy.usingAs, signOut: copy.signOut }}
        places={[
          ...(businesses ?? [business]).map((candidate) => ({
            key: candidate.id,
            title: candidate.name,
            hint: copy[`role${staffRole(candidate)}`],
            badge: <BuildingIcon />,
            current: candidate.id === business.id,
            onClick: () => {
              setBusiness(candidate);
              setDrawerOpen(false);
            },
          })),
          {
            key: "customer",
            title: copy.asCustomer,
            hint: copy.asCustomerHint,
            badge: <CalendarIcon />,
            onClick: () => router.push("/"),
          },
        ]}
      />
    </>
  );
}

export default function ManagePage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<Spinner />}>
      <ManageApp />
    </Suspense>
  );
}
