"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { staffRole } from "@/lib/roles.ts";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import {
  BottomNav,
  BuildingIcon,
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
import { Button, Note, Sheet, Spinner } from "@/components/ui.tsx";
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
    <Suspense fallback={<Spinner />}>
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

function CustomerAppInner() {
  const copy = useCopy("customer");
  // Only for the role each business is held under: the words live in the owner
  // dictionary, and one set of them beats two that drift apart.
  const ownerCopy = useCopy("owner");
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
  const [owned, setOwned] = useState<BusinessDto[]>([]);

  useEffect(() => {
    if (token === null) {
      setOwned([]);
      return;
    }
    api.myBusinesses(token).then(setOwned).catch(() => setOwned([]));
  }, [token]);

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

  if (loading) return <Spinner />;

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
        languageLabel={copy.langSwitch}
        {...(routeBusinessId !== null || screen === "profile"
          ? {
              onBack: () =>
                routeBusinessId !== null ? leaveBusiness("search") : setScreen("mine"),
              backLabel: copy.back,
            }
          : {})}
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
            <Spinner />
          )
        ) : (
          <>
            {screen === "search" && (
              <BusinessSearch
                onOpen={(picked) => {
                  // The business is already in hand, so the effect behind the
                  // route sees it as loaded and asks for nothing more.
                  setBusiness(picked);
                  openBusiness(picked.id);
                }}
              />
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
        labels={{ usingAs: copy.usingAs, signOut: copy.signOut }}
        places={[
          {
            key: "customer",
            title: copy.asCustomer,
            hint: copy.asCustomerHint,
            badge: <CalendarIcon />,
            current: true,
            onClick: () => setDrawerOpen(false),
          },
          ...owned.map((mine) => ({
            key: mine.id,
            title: mine.name,
            hint: `${ownerCopy[`role${staffRole(mine)}`]} · ${copy.manageIt}`,
            badge: <BuildingIcon />,
            onClick: () => router.push(`/manage?business=${mine.id}`),
          })),
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
        extra={
          owned.length === 0 ? (
            <>
              <Note>{copy.noBusinessNote}</Note>
              <Button onClick={() => router.push("/onboarding")}>{copy.openBusiness}</Button>
            </>
          ) : undefined
        }
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
