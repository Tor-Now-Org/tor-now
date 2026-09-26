import { describe, expect, it } from "vitest";
import {
  asId,
  instant,
  money,
  parseLocalDate,
  planTerms,
  timeZone,
  type Business,
  type PlanVersion,
  type Subscription,
} from "@tor-now/domain";
import { directoryRow, filterDirectory, NO_FILTER, type DirectoryRow } from "./business-directory.ts";

const day = parseLocalDate;
const today = day("2026-09-16");

const solo: PlanVersion = {
  id: asId("solo-1"),
  plan: "SOLO",
  number: 1,
  terms: planTerms({ features: [], resourceAllowance: 1, price: money(4900) }),
};
const team: PlanVersion = {
  id: asId("team-1"),
  plan: "TEAM",
  number: 1,
  terms: planTerms({ features: [], resourceAllowance: 5, price: money(8900) }),
};

const row = (
  name: string,
  subscription: Partial<Subscription>,
  options: { plan?: PlanVersion; active?: boolean; onOffer?: number; owner?: string } = {},
): DirectoryRow => {
  const business = {
    id: asId(name),
    name,
    phone: "+972500000001",
    timeZone: timeZone("Asia/Jerusalem"),
    active: options.active ?? true,
    createdAt: instant(0),
  } as Business;
  return directoryRow(
    {
      business,
      subscription: {
        id: asId(`s-${name}`),
        businessId: business.id,
        planVersionId: (options.plan ?? solo).id,
        trialEndsOn: null,
        paidThrough: null,
        scheduledMove: null,
        ...subscription,
      },
      resourcesOnOffer: options.onOffer ?? 1,
      owner: { name: options.owner ?? "רן", phone: "+972500000001" },
    },
    options.plan ?? solo,
    today,
  );
};

const rows = [
  row("Ran", { trialEndsOn: day("2026-09-23") }, { plan: team }),
  row("Noy", { paidThrough: day("2026-10-23") }),
  row("Dana", { paidThrough: day("2026-09-08") }, { owner: "דנה" }),
  row("Harbour", { trialEndsOn: day("2026-10-12") }, { plan: team }),
  row("Barber", { paidThrough: day("2026-10-30") }, { onOffer: 3 }),
  row("Shira", { paidThrough: day("2026-11-02") }, { plan: team, active: false }),
  row("Second", {}),
];

const names = (result: ReturnType<typeof filterDirectory>) => result.rows.map((r) => r.business.name);

describe("filterDirectory", () => {
  it("lists every Business, the one whose date comes soonest first and the undated last", () => {
    expect(names(filterDirectory(rows, NO_FILTER))).toEqual([
      "Dana", "Ran", "Harbour", "Noy", "Barber", "Shira", "Second",
    ]);
  });

  it("keeps a Business whose status is any of those chosen", () => {
    const result = filterDirectory(rows, { ...NO_FILTER, statuses: ["TRIAL", "IN_GRACE"] });
    expect(names(result)).toEqual(["Dana", "Ran", "Harbour"]);
  });

  it("keeps only a Business holding every flag chosen", () => {
    expect(names(filterDirectory(rows, { ...NO_FILTER, flags: ["TRIAL_ENDING"] }))).toEqual(["Ran"]);
    expect(names(filterDirectory(rows, { ...NO_FILTER, flags: ["TRIAL_ENDING", "OVER_ALLOWANCE"] }))).toEqual([]);
  });

  it("filters by plan", () => {
    expect(names(filterDirectory(rows, { ...NO_FILTER, plan: "TEAM" }))).toEqual(["Ran", "Harbour", "Shira"]);
  });

  it("searches the name and the owner's name, ignoring case", () => {
    expect(names(filterDirectory(rows, { ...NO_FILTER, query: "HARB" }))).toEqual(["Harbour"]);
    expect(names(filterDirectory(rows, { ...NO_FILTER, query: "דנה" }))).toEqual(["Dana"]);
    expect(names(filterDirectory(rows, { ...NO_FILTER, query: "   " }))).toHaveLength(rows.length);
  });

  it("counts each option as choosing it would show, with the other groups applied", () => {
    const { counts } = filterDirectory(rows, { ...NO_FILTER, statuses: ["TRIAL"], plan: "TEAM" });
    expect(counts.total).toBe(7);
    // Statuses are counted within Team: the Team trials, and the deactivated Team shop.
    expect(counts.statuses).toEqual({ TRIAL: 2, PAID: 0, IN_GRACE: 0, LAPSED: 0, DEACTIVATED: 1 });
    // Plans are counted within Trial.
    expect(counts.plans).toEqual({ SOLO: 0, TEAM: 2 });
    expect(counts.flags).toEqual({ TRIAL_ENDING: 1, MOVE_PENDING: 0, OVER_ALLOWANCE: 0 });
  });
});
