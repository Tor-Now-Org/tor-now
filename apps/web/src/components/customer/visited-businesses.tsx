"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { MyAppointmentDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { outcomeOfDto } from "../owner/appointment-sheet.tsx";
import { Card, Critical, Empty, Spinner } from "../ui.tsx";

/** One business per row, most recently visited first — visits that were cancelled don't count. */
const visitedBusinesses = (appointments: MyAppointmentDto[]) => {
  const finished = appointments
    .filter((appointment) => outcomeOfDto(appointment) === "FINISHED")
    .sort((a, b) => Date.parse(b.endAt) - Date.parse(a.endAt));

  const seen = new Set<string>();
  const businesses: { businessId: string; businessName: string; lastVisitAt: string }[] = [];
  for (const appointment of finished) {
    if (seen.has(appointment.businessId)) continue;
    seen.add(appointment.businessId);
    businesses.push({
      businessId: appointment.businessId,
      businessName: appointment.businessName,
      lastVisitAt: appointment.endAt,
    });
  }
  return businesses;
};

export const VisitedBusinesses = ({
  onOpenBusiness,
}: {
  onOpenBusiness: (businessId: string) => void;
}) => {
  const copy = useCopy("customer");
  const { token } = useSession();
  const errorText = useErrorText();

  const [appointments, setAppointments] = useState<MyAppointmentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (appointments === null) return <Spinner />;

  const businesses = visitedBusinesses(appointments);

  return (
    <div style={{ padding: "22px 18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 22 }}>{copy.visitedBusinesses}</h1>

      {error !== null && <Critical>{error}</Critical>}

      {businesses.length === 0 && (
        <Empty title={copy.noVisited} body={copy.noVisitedBody} />
      )}

      {businesses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {businesses.map((business) => (
            <button
              key={business.businessId}
              onClick={() => onOpenBusiness(business.businessId)}
              style={{ textAlign: "start", width: "100%" }}
            >
              <Card style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: "Rubik, sans-serif", fontWeight: 600, fontSize: 16.5 }}>
                  {business.businessName}
                </span>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
