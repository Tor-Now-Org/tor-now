"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import {
  BottomNav,
  CalendarIcon,
  PeopleIcon,
  ClockIcon,
  SearchIcon,
} from "@/components/bottom-nav.tsx";
import { BookingFlow } from "@/components/customer/booking-flow.tsx";
import { BusinessSearch } from "@/components/customer/business-search.tsx";
import { MyAppointments } from "@/components/customer/my-appointments.tsx";
import { Profile } from "@/components/customer/profile.tsx";
import { VisitedBusinesses } from "@/components/customer/visited-businesses.tsx";
import { AccountDrawer } from "@/components/account-drawer.tsx";
import { ContextSwitch } from "@/components/context-switch.tsx";
import {
  businessToManage,
  fetchBusinesses,
  knownBusinesses,
  lastManaged,
  rememberBusinesses,
  rememberManaged,
} from "@/lib/last-managed.ts";
import { DismissableOwnerPitch, OwnerPitch } from "@/components/owner-pitch.tsx";
import { Button, Sheet, Spinner } from "@/components/ui.tsx";
import { VerifyPanel } from "@/components/verify-panel.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";

/** A business is not here: it has a path of its own, and the path decides. */
type Screen = "search" | "mine" | "visited" | "profile";

/**
 * The customer application. One identity and two contexts: the drawer offers
 * the same person's businesses, because ownership is a Membership rather than a
 * kind of account (CONTEXT.md), and someone with no business is offered the
 * wizard instead.
 */
export default function CustomerApp() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense
      fallback={
        // The first thing on screen, with no header yet: centred on the whole
        // shell (both grid rows on desktop), lifted above true centre, where it reads as centred.
        <div style={{ flex: 1, gridRow: "1 / -1", display: "grid", placeItems: "center" }}>
          <span className="spinner spinner-page" style={{ translate: "0 -20px" }} />
        </div>
      }
    >
      <CustomerAppInner />
    </Suspense>
  );
}

/** The path a business lives at, so a customer can be sent straight to it. */
const businessPath = (businessId: string) => `/business/${businessId}`;

/**
 * The screen a business page is left for. Leaving means a different route, and
 * a different route means a fresh mount: state cannot carry the answer across,
 * so the address does.
 */
const SCREENS = ["search", "mine", "visited", "profile"] as const;
const screenIn = (param: string | null): Screen =>
  SCREENS.find((name) => name === param) ?? "search";

const homePath = (screen: Screen) => (screen === "search" ? "/" : `/?screen=${screen}`);

const businessIdIn = (pathname: string): string | null => {
  const rest = pathname.startsWith("/business/")
    ? pathname.slice("/business/".length)
    : "";
  return rest === "" ? null : decodeURIComponent(rest);
};

/**
 * Whether this mount is the tab opening the app at a bare `/`. Staff opening
 * the app mean their diary, so that arrival goes to /manage — and only that
 * one: "לקוח" in the switch also leads here, and must stay here, whether the
 * tab started at `/` or somewhere else. In memory on purpose — a fresh load or
 * launch is a fresh arrival.
 */
let arriving = true;
const openedAtRoot = (): boolean => {
  if (typeof window === "undefined") return false;
  const entry = performance.getEntriesByType("navigation")[0];
  const url = new URL(entry?.name ?? window.location.href);
  return url.pathname === "/" && url.searchParams.get("screen") === null;
};

function CustomerAppInner() {
  const copy = useCopy("customer");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const errorText = useErrorText();
  const { token, user, loading, signIn } = useSession();

  // Which business is open is the path's business to know, not the state's;
  // the rest of the screens have no address of their own and keep using state.
  const routeBusinessId = businessIdIn(pathname);
  const [screen, setScreen] = useState<Screen>(screenIn(searchParams.get("screen")));
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  /** Where the person was heading when sign-in interrupted them, if anywhere. */
  const [signInIntent, setSignInIntent] = useState<Screen | null>(null);
  /** The businesses this person works at, for the drawer's list of places. */
  const [owned, setOwned] = useState<BusinessDto[] | null>(knownBusinesses);

  useEffect(() => {
    if (token === null) {
      rememberBusinesses(null);
      setOwned([]);
      return;
    }
    fetchBusinesses(token, { join: true })
      .then((mine) => {
        rememberBusinesses(mine);
        setOwned(mine);
      })
      // The drawer simply lists no places; the invitation does not hang on this.
      .catch(() => undefined);
  }, [token]);

  /**
   * Nothing to own yet — the one question the invitation asks, answered by
   * `/me` alongside the person themself, so it needs no second request and
   * never flickers in and out while one is in flight.
   */
  const ownsNothing = !loading && (user === null || !user.isHasBusinesses);

  // Captured per mount, so a re-render while the redirect is in flight cannot
  // flash the customer screen. /manage picks the business they were last in.
  const [arrived] = useState(() => arriving && openedAtRoot());
  const toManage =
    arrived &&
    pathname === "/" &&
    searchParams.get("screen") === null &&
    user?.isHasBusinesses === true;
  // The diary's code, fetched while `/me` is still out: the spinner hides the
  // header switch that would otherwise have prefetched it, so the hand-over
  // used to start with a download. The device's memory is only a hint here.
  useEffect(() => {
    if (arrived && lastManaged() !== null) router.prefetch("/manage");
  }, [arrived, router]);
  useEffect(() => {
    if (loading) return;
    arriving = false;
    if (toManage) router.replace("/manage");
  }, [loading, toManage, router]);

  /**
   * The path is what says which business is open, so a link and a tap arrive
   * the same way: navigation changes the URL, and this fills in the business
   * behind it — including on a cold load, where nothing was tapped at all.
   *
   * Awaited rather than left to float: a rejected fetch used to make the tap do
   * nothing, with the failure going nowhere a person or a log could see it.
   */
  useEffect(() => {
    if (routeBusinessId === null) return;
    if (business?.id === routeBusinessId) return;
    let current = true;
    api
      .businessProfile(routeBusinessId)
      .then((profile) => {
        if (current) setBusiness(profile.business);
      })
      .catch((cause: unknown) => {
        console.error("[business] could not be opened", {
          businessId: routeBusinessId,
          cause,
        });
        if (current) router.replace("/");
      });
    return () => {
      current = false;
    };
  }, [routeBusinessId, business?.id, router]);

  // Same reasoning as the owner app: the header stays, so crossing back does
  // not blank the screen — only the part nobody knows yet waits.
  // The manage page's own loading frame, so the hand-over shows nothing at all.
  if (loading || toManage) {
    return (
      <>
        <AppHeader />
        <main style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Spinner page />
        </main>
      </>
    );
  }

  const openBusiness = (businessId: string) => router.push(businessPath(businessId));

  /** Leaving a business takes the address bar with it. */
  const leaveBusiness = (next: Screen) => {
    setScreen(next);
    if (routeBusinessId !== null) router.push(homePath(next));
  };

  const requireSession = (next: Screen) => {
    if (token === null) {
      setSignInIntent(next);
      setSignInOpen(true);
      return;
    }
    leaveBusiness(next);
  };

  const showingBusiness = routeBusinessId !== null && business?.id === routeBusinessId;

  return (
    <>
      <AppHeader
        {...(routeBusinessId !== null || screen === "profile"
          ? {
              onBack: () =>
                routeBusinessId !== null ? leaveBusiness("search") : setScreen("mine"),
              backLabel: copy.back,
            }
          : {})}
        // One tap into the diary they were last in. Absent for somebody who
        // staffs nothing, which is almost everybody.
        switcher={
          <ContextSwitch
            businesses={owned ?? []}
            current={null}
            onCustomer={() => undefined}
            onManage={(mine) => {
              const wanted = businessToManage(owned ?? [], lastManaged()) ?? mine;
              rememberManaged(wanted.id);
              router.push(`/manage?business=${wanted.id}`);
            }}
          />
        }
        trailing={
          user !== null ? (
            <AccountButton
              initial={user.name.trim().charAt(0) || "?"}
              onClick={() => setDrawerOpen(true)}
              label={copy.account}
            />
          ) : (
            // The way in, from the screen a stranger actually lands on. Signing
            // in from here is not on the way to anywhere, so it returns the
            // person to whatever they were already looking at.
            <AccountButton
              onClick={() => {
                setSignInIntent(null);
                setSignInOpen(true);
              }}
              label={copy.signInOrUp}
            />
          )
        }
      />

      <main className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {routeBusinessId !== null ? (
          showingBusiness ? (
            business.active ? (
              <BookingFlow business={business} onFinished={() => leaveBusiness("mine")} />
            ) : (
              <Sheet open onClose={() => leaveBusiness("search")} labelledBy="business-inactive-title">
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <h2 id="business-inactive-title" style={{ fontSize: 19 }}>{copy.businessInactiveTitle}</h2>
                  <p style={{ margin: 0 }}>{copy.businessInactiveBody}</p>
                  <Button onClick={() => leaveBusiness("search")}>{copy.back}</Button>
                </div>
              </Sheet>
            )
          ) : (
            <Spinner page />
          )
        ) : (
          <>
            {screen === "search" && (
              <>
                <BusinessSearch
                  onOpen={(picked) => {
                    // The business is already in hand, so the effect behind the
                    // route sees it as loaded and asks for nothing more.
                    setBusiness(picked);
                    openBusiness(picked.id);
                  }}
                />
                {/* Under the results, where "I could be listed here" is the
                    thought the screen already provoked. Offered only to
                    somebody who holds no business, and closeable for good. */}
                {ownsNothing && (
                  <div style={{ padding: "0 18px 24px" }}>
                    <DismissableOwnerPitch />
                  </div>
                )}
              </>
            )}
            {screen === "mine" && <MyAppointments onOpenBusiness={openBusiness} />}
            {screen === "visited" && <VisitedBusinesses onOpenBusiness={openBusiness} />}
            {screen === "profile" && <Profile onSignedOut={() => setScreen("search")} />}
          </>
        )}
      </main>

      <BottomNav
        current={routeBusinessId !== null ? "search" : screen === "profile" ? "mine" : screen}
        onSelect={(id) =>
          id === "search" ? leaveBusiness("search") : requireSession(id as Screen)
        }
        items={[
          { id: "search", label: copy.tabSearch, icon: <SearchIcon /> },
          { id: "mine", label: copy.tabMine, icon: <CalendarIcon /> },
          { id: "visited", label: copy.tabVisited, icon: <ClockIcon /> },
        ]}
      />

      {/* One identity, two contexts. The drawer is the only place the two meet. */}
      <AccountDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        {...(user === null ? {} : { userName: user.name })}
        labels={{ account: copy.account, signOut: copy.signOut }}
        places={[
          // Only where you are: crossing over is the header switch's job.
          // With no business there is no other context, so not even this.
          ...(ownsNothing
            ? []
            : [
                {
                  key: "customer",
                  title: copy.asCustomer,
                  hint: copy.asCustomerHint,
                  badge: <CalendarIcon />,
                  current: true,
                  onClick: () => setDrawerOpen(false),
                },
              ]),
          {
            key: "profile",
            title: copy.profile,
            badge: <PeopleIcon />,
            onClick: () => {
              setDrawerOpen(false);
              leaveBusiness("profile");
            },
          },
        ]}
        extra={ownsNothing ? <OwnerPitch /> : undefined}
        onSignedOut={() => {
          setDrawerOpen(false);
          leaveBusiness("search");
        }}
      />

      <Sheet open={signInOpen} onClose={() => setSignInOpen(false)}>
        <VerifyPanel
          labels={{
            title: copy.verifyTitle,
            body: copy.verifyBody,
            phoneLabel: copy.phoneLabel,
            sendCode: copy.sendCode,
            codeLabel: copy.codeLabel,
            verify: copy.verify,
            nameTitle: copy.nameTitle,
            nameBody: copy.nameBody,
            firstName: copy.firstName,
            lastName: copy.lastName,
            saveName: copy.saveName,
          }}
          errorText={errorText}
          onVerified={(newToken, newUser) => {
            signIn(newToken, newUser);
            setSignInOpen(false);
            if (signInIntent !== null) {
              leaveBusiness(signInIntent);
              setSignInIntent(null);
            }
          }}
        />
      </Sheet>
    </>
  );
}
