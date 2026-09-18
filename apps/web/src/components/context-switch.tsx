"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BusinessDto } from "@/lib/api/types.ts";
import { staffRole } from "@/lib/roles.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { BuildingIcon, CalendarIcon } from "./bottom-nav.tsx";
import { PlaceList } from "./account-drawer.tsx";
import { Sheet } from "./ui.tsx";

/**
 * One identity, two contexts, one control.
 *
 * Crossing from the customer app to a business used to cost two taps and the
 * first was a guess: the account circle, then the business in the drawer.
 * Coming back cost one — the chevron — so the trip was not only long in one
 * direction, it was a different control each way.
 *
 * This is the same control both ways, in the same corner. Going in is one tap
 * whatever somebody owns, because "ניהול" means the diary they were last in
 * rather than a question about which. Which business is a question for the
 * inside, where it is rare and where the switch has the room to carry the
 * answer: with more than one, the pressed half wears the shop's name and a
 * caret, and the list it opens is the drawer's own rows — the same badge, the
 * same role, the same mark on where you are.
 */
export const ContextSwitch = ({
  businesses,
  current,
  onCustomer,
  onManage,
}: {
  /** Everything this person staffs. Empty means the switch is not drawn. */
  businesses: readonly BusinessDto[];
  /** The business being managed, or null in the customer app. */
  current: BusinessDto | null;
  onCustomer: () => void;
  /** Going in, or going across. */
  onManage: (business: BusinessDto) => void;
}) => {
  const copy = useCopy("owner");
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  /**
   * The press, while the other side is being fetched.
   *
   * Crossing over is a route change, and a route change that is not marked
   * looks like nothing happened until the new page arrives — so people press
   * again. React keeps the current screen on the glass through a transition,
   * which is exactly what makes this feel like a switch rather than a reload;
   * all it needs from us is to say the press is still in flight.
   */
  const [crossing, startCrossing] = useTransition();

  // The code for the other side, fetched before it is wanted. Without it the
  // first crossing pays for a chunk download while the screen sits still.
  useEffect(() => {
    router.prefetch(current === null ? "/manage" : "/");
  }, [router, current]);

  if (businesses.length === 0) return null;
  const several = businesses.length > 1;
  const managing = current !== null;

  /**
   * What the managing half says.
   *
   * "ניהול" while there is only one thing it can mean. With several it carries
   * the shop instead, because a button whose destination you cannot see is a
   * button you have to press to find out — and the caret is the promise that
   * pressing it again offers the others.
   */
  const label = managing && several ? current.name : copy.manageWord;

  return (
    <>
      <div
        role="group"
        aria-label={copy.switchContext}
        style={{
          display: "inline-flex",
          gap: 3,
          padding: 3,
          minWidth: 0,
          borderRadius: 999,
          background: "var(--sunken)",
          border: "1px solid var(--line)",
        }}
      >
        <button
          aria-pressed={!managing}
          aria-busy={crossing && managing}
          onClick={() => {
            if (managing) startCrossing(onCustomer);
          }}
          style={half(!managing)}
        >
          {crossing && managing ? <Pip /> : null}
          {copy.asCustomerShort}
        </button>
        <button
          aria-pressed={managing}
          aria-busy={crossing && !managing}
          onClick={() => {
            if (!managing) {
              const first = businesses[0];
              if (first !== undefined) startCrossing(() => onManage(first));
              return;
            }
            // Already inside: the only thing left to offer is the others.
            if (several) setChoosing(true);
          }}
          style={{ ...half(managing), maxWidth: 148 }}
        >
          {crossing && !managing ? <Pip /> : null}
          {managing && several && (
            <span
              aria-hidden="true"
              style={{
                width: 18,
                height: 18,
                flexShrink: 0,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                fontSize: 9.5,
                fontWeight: 600,
                background: "var(--accent)",
                color: "var(--on-accent)",
              }}
            >
              {current.name.trim().charAt(0) || "?"}
            </span>
          )}
          <span
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {label}
          </span>
          {managing && several && (
            <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>
              ▾
            </span>
          )}
        </button>
      </div>

      <Sheet open={choosing} onClose={() => setChoosing(false)} labelledBy="which-business">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id="which-business" style={{ fontSize: 17 }}>
            {copy.whichBusiness}
          </h2>
          {/* The drawer's rows, not a second design for the same list. */}
          <PlaceList
            places={businesses.map((business) => ({
              key: business.id,
              title: business.name,
              hint: copy[`role${staffRole(business)}`],
              badge: <BuildingIcon />,
              current: business.id === current?.id,
              onClick: () => {
                setChoosing(false);
                if (business.id !== current?.id) startCrossing(() => onManage(business));
              },
            }))}
          />
          <PlaceList
            places={[
              {
                key: "customer",
                title: copy.asCustomer,
                badge: <CalendarIcon />,
                onClick: () => {
                  setChoosing(false);
                  startCrossing(onCustomer);
                },
              },
            ]}
          />
        </div>
      </Sheet>
    </>
  );
};

/**
 * A press that has not landed yet.
 *
 * Small enough to sit inside the half without changing its width — the switch
 * must not move under the finger that just pressed it.
 */
const Pip = () => (
  <span
    aria-hidden="true"
    style={{
      width: 11,
      height: 11,
      flexShrink: 0,
      borderRadius: 999,
      border: "2px solid currentColor",
      borderTopColor: "transparent",
      animation: "spin .6s linear infinite",
      opacity: 0.8,
    }}
  />
);

/** Both halves are the same control; only the pressed one is raised. */
const half = (pressed: boolean) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minWidth: 0,
  minHeight: 34,
  padding: "0 12px",
  borderRadius: 999,
  fontFamily: "Rubik, sans-serif",
  fontSize: 13,
  fontWeight: 600,
  background: pressed ? "var(--raised)" : "transparent",
  color: pressed ? "var(--ink)" : "var(--muted)",
  boxShadow: pressed ? "0 1px 2px oklch(25% 0.055 258/.10)" : "none",
});
