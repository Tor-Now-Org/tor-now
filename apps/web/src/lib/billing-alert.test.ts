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
  const billing = (status: string, trialEndsOn: string | null = null) => ({ status, subscription: { trialEndsOn } });

  it("says the Trial was used elsewhere when the Business never had one", () => {
    expect(payTodayNote(billing("LAPSED"), null)).toBe("lapsedSoonNote");
  });

  it("says only that it is unpaid when it had a Trial of its own", () => {
    expect(payTodayNote(billing("LAPSED", "2026-09-23"), null)).toBe("lapsedSoonPaidNote");
  });

  it("asks for payment for the whole Grace Period", () => {
    expect(payTodayNote(billing("IN_GRACE"), 14)).toBe("inGraceNote");
    expect(payTodayNote(billing("IN_GRACE"), 0)).toBe("inGraceNote");
  });

  it("asks for payment in a Trial's last three days, its last day included", () => {
    expect(payTodayNote(billing("TRIAL", "2026-10-13"), 3)).toBe("trialEndingNote");
    expect(payTodayNote(billing("TRIAL", "2026-10-10"), 0)).toBe("trialEndingNote");
    expect(payTodayNote(billing("TRIAL", "2026-10-14"), 4)).toBeNull();
  });

  it("says nothing while paid or switched off", () => {
    for (const status of ["PAID", "DEACTIVATED"]) expect(payTodayNote(billing(status), 1)).toBeNull();
  });
});
