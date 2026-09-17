"use client";

import { useCallback, useEffect, useState } from "react";
import { categoryLabel, type BusinessCategory } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, MyAppointmentDto } from "@/lib/api/types.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { outcomeOfDto } from "../owner/appointment-sheet.tsx";
import { Card, Critical, Empty, Spinner } from "../ui.tsx";
import { HeartIcon, readFavorites, tagStyle, writeFavorites } from "./business-search.tsx";
import { AllCategoriesIcon, CategoryIcon } from "./category-icons.tsx";

/** One business per row, most recently visited first — visits that were cancelled don't count. */
const visitedBusinesses = (appointments: MyAppointmentDto[]) => {
  const finished = appointments
    .filter((appointment) => outcomeOfDto(appointment) === "FINISHED")
    .sort((a, b) => Date.parse(b.endAt) - Date.parse(a.endAt));

  const byBusiness = new Map<
    string,
    {
      businessId: string;
      businessName: string;
      businessCategory: BusinessCategory | null;
      businessAddress: string | null;
      lastVisitAt: string;
      visits: number;
    }
  >();
  for (const appointment of finished) {
    const known = byBusiness.get(appointment.businessId);
    if (known !== undefined) known.visits += 1;
    else
      byBusiness.set(appointment.businessId, {
        businessId: appointment.businessId,
        businessName: appointment.businessName,
        businessCategory: appointment.businessCategory,
        businessAddress: appointment.businessAddress,
        lastVisitAt: appointment.endAt,
        visits: 1,
      });
  }
  return [...byBusiness.values()];
};

export const VisitedBusinesses = ({
  onOpenBusiness,
}: {
  onOpenBusiness: (businessId: string) => void;
}) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const { token } = useSession();
  const errorText = useErrorText();

  const [appointments, setAppointments] = useState<MyAppointmentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, BusinessDto>>(new Map());
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites());

  const load = useCallback(async () => {
    if (token === null) return;
    try {
      setAppointments(await api.myAppointments(token));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const businesses = appointments === null ? [] : visitedBusinesses(appointments);
  const businessIds = businesses.map((business) => business.businessId).join(",");

  // ponytail: one profile request per business, same as favorites in search; a batch endpoint if the list grows long.
  useEffect(() => {
    if (businessIds === "") return;
    let cancelled = false;
    void Promise.all(
      businessIds.split(",").map((businessId) =>
        api.businessProfile(businessId).then(
          (profile) => profile.business,
          () => null, // Gone or unreachable: the card just keeps the name.
        ),
      ),
    ).then((found) => {
      if (!cancelled) setProfiles(new Map(found.filter((b): b is BusinessDto => b !== null).map((b) => [b.id, b])));
    });
    return () => {
      cancelled = true;
    };
  }, [businessIds]);

  const toggleFavorite = (businessId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(businessId)) next.delete(businessId);
      else next.add(businessId);
      writeFavorites(next);
      return next;
    });
  };

  if (appointments === null && error === null) return <Spinner />;

  const dateFormat = new Intl.DateTimeFormat(language === "he" ? "he-IL" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{ padding: "28px 18px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 26, lineHeight: 1.2, textAlign: "center", paddingTop: 14 }}>{copy.visitedBusinesses}</h1>

      {error !== null && <Critical>{error}</Critical>}

      {appointments !== null && businesses.length === 0 && (
        <Empty title={copy.noVisited} body={copy.noVisitedBody} />
      )}

      {businesses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {businesses.map(({ businessId, businessName, businessCategory, businessAddress, lastVisitAt, visits }) => {
            const business = profiles.get(businessId);
            // Both come with the appointment, so the card is whole on first paint
            // rather than growing a line and a tag when the profiles land.
            const category = business?.category ?? businessCategory;
            const isFavorite = favorites.has(businessId);

            return (
              <div key={businessId} style={{ position: "relative" }}>
                <button onClick={() => onOpenBusiness(businessId)} style={{ textAlign: "start", width: "100%" }}>
                  <Card style={{ width: "100%", display: "flex", gap: 12, alignItems: "flex-start", paddingInlineEnd: 48 }}>
                    <span
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        background: "var(--sunken)",
                        color: "var(--muted)",
                      }}
                    >
                      {category != null ? <CategoryIcon category={category} /> : <AllCategoriesIcon />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 16.5 }}>
                        {business?.name ?? businessName}
                      </span>
                      {(business?.address ?? businessAddress) != null && (
                        <span className="hint">{business?.address ?? businessAddress}</span>
                      )}
                      <span className="hint">{copy.lastVisit.replace("{date}", dateFormat.format(new Date(lastVisitAt)))}</span>
                      <span style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {category != null && (
                          <span style={{ ...tagStyle, background: "var(--sunken)", color: "var(--muted)" }}>
                            {categoryLabel(category, language)}
                          </span>
                        )}
                        {visits > 1 && (
                          <span style={{ ...tagStyle, background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                            {copy.visitCount.replace("{count}", String(visits))}
                          </span>
                        )}
                        {business?.openNow !== undefined && (
                          <span
                            style={{
                              ...tagStyle,
                              background: business.openNow ? "var(--positive-soft)" : "var(--sunken)",
                              color: business.openNow ? "var(--positive)" : "var(--faint)",
                            }}
                          >
                            {business.openNow ? copy.openNow : copy.closedNow}
                          </span>
                        )}
                      </span>
                    </span>
                  </Card>
                </button>
                <button
                  onClick={() => toggleFavorite(businessId)}
                  aria-pressed={isFavorite}
                  aria-label={isFavorite ? copy.removeFavorite : copy.addFavorite}
                  style={{
                    position: "absolute",
                    insetBlockStart: 8,
                    insetInlineEnd: 8,
                    width: 34,
                    height: 34,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 999,
                    color: isFavorite ? "var(--critical)" : "var(--faint)",
                    background: isFavorite ? "var(--critical-soft)" : "transparent",
                    transition: "background .13s ease, color .13s ease",
                  }}
                >
                  <HeartIcon filled={isFavorite} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
