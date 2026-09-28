import { describe, expect, it } from "vitest";
import { everyPlanWould, placementChanges, priceChange, riseCancellable, risePending } from "./addon-catalogue.ts";

const history = {
  plans: [
    { plan: "SOLO" as const, number: 1, included: false },
    { plan: "TEAM" as const, number: 1, included: true },
  ],
};

describe("which plans", () => {
  it("changes only the Plans whose answer changes", () => {
    expect(placementChanges(history, ["TEAM"])).toEqual([]);
    expect(placementChanges(history, ["SOLO", "TEAM"])).toEqual([{ plan: "SOLO", include: true }]);
    expect(placementChanges(history, ["SOLO"])).toEqual([
      { plan: "SOLO", include: true },
      { plan: "TEAM", include: false },
    ]);
  });

  it("knows when every Plan would have it", () => {
    expect(everyPlanWould(history, ["SOLO", "TEAM"])).toBe(true);
    expect(everyPlanWould(history, ["TEAM"])).toBe(false);
  });
});

describe("an Add-on's price", () => {
  it("rises, drops, stays, or is not a price", () => {
    expect(priceChange(1900, 2400)).toBe("RISE");
    expect(priceChange(1900, 1500)).toBe("DROP");
    expect(priceChange(1900, 1900)).toBe("SAME");
    expect(priceChange(1900, null)).toBe("INVALID");
    expect(priceChange(1900, 0)).toBe("INVALID");
  });

  it("has a rise pending until the last holder pays it, cancellable until the first does", () => {
    const rise = { fromMinor: 1900, announcedOn: "2026-10-02", firstOn: "2026-11-11", lastOn: "2026-11-26" };
    expect(risePending(rise, "2026-11-25")).toBe(true);
    expect(risePending(rise, "2026-11-26")).toBe(false);
    expect(risePending(null, "2026-11-25")).toBe(false);
    expect(riseCancellable(rise, "2026-11-10")).toBe(true);
    expect(riseCancellable(rise, "2026-11-11")).toBe(false);
  });
});
