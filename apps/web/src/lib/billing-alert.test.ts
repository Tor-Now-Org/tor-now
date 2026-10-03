import { describe, expect, it } from "vitest";
import { deactivationDeadline, payTodayNote } from "./billing-alert.ts";

describe("deactivationDeadline", () => {
  const at = (iso: string) => new Date(iso);

  it("is tomorrow morning for a Business opened in the afternoon", () => {
    expect(deactivationDeadline("Asia/Jerusalem", at("2026-10-03T11:00:00.000Z"))).toEqual({
      date: "2026-10-04",
      tomorrow: true,
      time: "07:00",
    });
  });

  it("is later today once past midnight, before the run", () => {
    expect(deactivationDeadline("Asia/Jerusalem", at("2026-10-03T23:30:00.000Z"))).toEqual({
      date: "2026-10-04",
      tomorrow: false,
      time: "07:00",
    });
  });

  it("is on the Business's clock, an hour earlier in Israel's winter", () => {
    expect(deactivationDeadline("Asia/Jerusalem", at("2026-11-03T11:00:00.000Z")).time).toBe("06:00");
  });
});

describe("payTodayNote", () => {
  const lapsed = (trialEndsOn: string | null) => ({ status: "LAPSED" as const, subscription: { trialEndsOn } });

  it("says the Trial was used elsewhere when the Business never had one", () => {
    expect(payTodayNote(lapsed(null))).toBe("lapsedSoonNote");
  });

  it("says only that it is unpaid when it had a Trial of its own", () => {
    expect(payTodayNote(lapsed("2026-09-23"))).toBe("lapsedSoonPaidNote");
  });

  it("says nothing for any other status", () => {
    for (const status of ["TRIAL", "PAID", "IN_GRACE", "DEACTIVATED"] as const) {
      expect(payTodayNote({ status, subscription: { trialEndsOn: null } })).toBeNull();
    }
  });
});
