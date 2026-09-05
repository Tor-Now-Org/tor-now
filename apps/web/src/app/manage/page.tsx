"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto, ResourceDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import { SignOutButton } from "@/components/sign-out.tsx";
import { SupportLink } from "@/components/support-link.tsx";
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
import { Button, Card, Empty, Note, Sheet, Spinner } from "@/components/ui.tsx";

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
    if (token === null || business === null) return;
    setResources(await api.listResources(token, business.id));
  }, [token, business]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

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
        {tab === "day" && (
          <CalendarDay token={token} business={business} resources={resources} />
        )}
        {tab === "schedule" && (
          <Schedule
            token={token}
            business={business}
            resources={resources}
            {...(editingCalendar === null ? {} : { openOn: editingCalendar })}
          />
        )}
        {tab === "business" && (
          <BusinessPanel
            token={token}
            business={business}
            resources={resources}
            // Editing a calendar means its schedule, so the tab changes with it.
            onEditCalendar={(resourceId) => {
              setEditingCalendar(resourceId);
              setTab("schedule");
            }}
            onChanged={() => {
              void loadBusinesses();
              void loadResources();
            }}
          />
        )}
        {tab === "customers" && <Customers token={token} business={business} />}
      </main>

      <BottomNav
        current={tab}
        onSelect={(id) => {
          setEditingCalendar(null);
          setTab(id as Tab);
        }}
        items={[
          { id: "day", label: copy.tabDay, icon: <CalendarIcon /> },
          { id: "schedule", label: copy.tabSchedule, icon: <ClockIcon /> },
          { id: "business", label: copy.tabBusiness, icon: <BuildingIcon /> },
          { id: "customers", label: copy.tabCustomers, icon: <PeopleIcon /> },
        ]}
      />

      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 19 }}>{copy.usingAs}</h2>
          <Card style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 600 }}>{copy.managingNow}</span>
            <span className="hint">{business.name}</span>
          </Card>
          {(businesses ?? []).length > 1 &&
            (businesses ?? []).map((candidate) => (
              <Button
                key={candidate.id}
                intent="quiet"
                onClick={() => {
                  setBusiness(candidate);
                  setDrawerOpen(false);
                }}
              >
                {candidate.name}
              </Button>
            ))}
          <Button onClick={() => router.push("/")}>{copy.asCustomer}</Button>
          <Note>{copy.oneIdentity}</Note>
          <SignOutButton label={copy.signOut} />
          <SupportLink />
        </div>
      </Sheet>
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
