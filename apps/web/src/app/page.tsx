"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { AccountButton, AppHeader } from "@/components/app-header.tsx";
import {
  BottomNav,
  CalendarIcon,
  ClockIcon,
  SearchIcon,
} from "@/components/bottom-nav.tsx";
import { BookingFlow } from "@/components/customer/booking-flow.tsx";
import { BusinessSearch } from "@/components/customer/business-search.tsx";
import { MyAppointments } from "@/components/customer/my-appointments.tsx";
import { Profile } from "@/components/customer/profile.tsx";
import { VisitedBusinesses } from "@/components/customer/visited-businesses.tsx";
import { SignOutButton } from "@/components/sign-out.tsx";
import { Button, Card, Note, Sheet, Spinner } from "@/components/ui.tsx";
import { VerifyPanel } from "@/components/verify-panel.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";

type Screen = "search" | "business" | "mine" | "visited" | "profile";

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

function CustomerAppInner() {
  const copy = useCopy("customer");
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorText = useErrorText();
  const { token, user, loading, signIn } = useSession();

  const [screen, setScreen] = useState<Screen>(
    searchParams.get("screen") === "profile" ? "profile" : "search",
  );
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

  if (loading) return <Spinner />;

  const requireSession = (next: Screen) => {
    if (token === null) {
      setSignInIntent(next);
      setSignInOpen(true);
      return;
    }
    setScreen(next);
  };

  const showingBusiness = screen === "business" && business !== null;

  return (
    <>
      <AppHeader
        languageLabel={copy.langSwitch}
        {...(showingBusiness || screen === "profile"
          ? {
              onBack: () => setScreen(showingBusiness ? "search" : "mine"),
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
        {screen === "search" && (
          <BusinessSearch
            onOpen={(picked) => {
              setBusiness(picked);
              setScreen("business");
            }}
          />
        )}
        {showingBusiness && (
          <BookingFlow business={business} onFinished={() => setScreen("mine")} />
        )}
        {screen === "mine" && (
          <MyAppointments
            onOpenBusiness={(businessId) => {
              api.businessProfile(businessId).then((profile) => {
                setBusiness(profile.business);
                setScreen("business");
              });
            }}
          />
        )}
        {screen === "visited" && (
          <VisitedBusinesses
            onOpenBusiness={(businessId) => {
              api.businessProfile(businessId).then((profile) => {
                setBusiness(profile.business);
                setScreen("business");
              });
            }}
          />
        )}
        {screen === "profile" && <Profile onSignedOut={() => setScreen("search")} />}
      </main>

      <BottomNav
        current={screen === "business" ? "search" : screen === "profile" ? "mine" : screen}
        onSelect={(id) => (id === "search" ? setScreen("search") : requireSession(id as Screen))}
        items={[
          { id: "search", label: copy.tabSearch, icon: <SearchIcon /> },
          { id: "mine", label: copy.tabMine, icon: <CalendarIcon /> },
          { id: "visited", label: copy.tabVisited, icon: <ClockIcon /> },
        ]}
      />

      {/* One identity, two contexts. The drawer is the only place the two meet. */}
      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} labelledBy="drawer-title">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="drawer-title" style={{ fontSize: 19 }}>{copy.usingAs}</h2>

          <Card style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 600 }}>{copy.asCustomer}</span>
            <span className="hint">{copy.asCustomerHint}</span>
          </Card>

          {owned.length > 0 ? (
            owned.map((mine) => (
              <Button
                key={mine.id}
                onClick={() => router.push(`/manage?business=${mine.id}`)}
              >
                {copy.manageIt} · {mine.name}
              </Button>
            ))
          ) : (
            <>
              <Note>{copy.noBusinessNote}</Note>
              <Button onClick={() => router.push("/onboarding")}>
                {copy.openBusiness}
              </Button>
            </>
          )}

          <Button intent="quiet" onClick={() => { setDrawerOpen(false); setScreen("profile"); }}>
            {copy.profile}
          </Button>
          <SignOutButton
            label={copy.signOut}
            onSignedOut={() => {
              setDrawerOpen(false);
              setScreen("search");
            }}
          />
        </div>
      </Sheet>

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
              setScreen(signInIntent);
              setSignInIntent(null);
            }
          }}
        />
      </Sheet>
    </>
  );
}
