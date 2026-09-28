import { describe, expect, it } from "vitest";
import type { PaymentBoardDto } from "@/lib/api/types.ts";
import { daysOf, lastPaidDay, monthlyTotal, totalAfterAdding, totalAfterCancelling } from "./next-payment.ts";

const payment: PaymentBoardDto["nextPayment"] = {
  on: "2026-11-27",
  totalMinor: 4900 + 1900 + 950,
  lines: [
    { kind: "PLAN", plan: "SOLO", amountMinor: 4900 },
    { kind: "ADDON", feature: "CUSTOMER_HISTORY", amountMinor: 1900 },
    {
      kind: "DAYS",
      owed: { kind: "ADDON_DAYS", subject: "CUSTOMER_HISTORY", amountMinor: 950, from: "2026-11-12", through: "2026-11-26" },
      amountMinor: 950,
    },
  ],
};

describe("the next payment", () => {
  it("costs the Plan and the Add-ons each month, the days owed once", () => {
    expect(monthlyTotal(payment)).toBe(6800);
  });

  it("gains an Add-on's price when it is paid by then, and the days owed for adding it back", () => {
    expect(totalAfterAdding(payment, { priceMinor: 900, ifAdded: { paysFrom: "2026-11-27", owed: null } })).toBe(8650);
    expect(
      totalAfterAdding(payment, {
        priceMinor: 900,
        ifAdded: { paysFrom: "2026-11-27", owed: { amountMinor: 450, from: "2026-11-12", through: "2026-11-26" } },
      }),
    ).toBe(9100);
    // Added while a Preview still gives it: paid only after the Preview ends.
    expect(totalAfterAdding(payment, { priceMinor: 900, ifAdded: { paysFrom: "2026-12-27", owed: null } })).toBe(7750);
    expect(totalAfterAdding(payment, { priceMinor: 900, ifAdded: null })).toBe(7750);
  });

  it("loses a cancelled Add-on's line, and it runs to the day before", () => {
    expect(totalAfterCancelling(payment, "CUSTOMER_HISTORY")).toBe(5850);
    expect(totalAfterCancelling(payment, "WAITING_LIST")).toBe(7750);
    expect(lastPaidDay(payment)).toBe("2026-11-26");
  });

  it("counts the days owed with both ends", () => {
    expect(daysOf({ amountMinor: 950, from: "2026-11-12", through: "2026-11-26" })).toBe(15);
  });
});
