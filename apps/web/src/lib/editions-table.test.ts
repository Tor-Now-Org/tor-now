import { describe, expect, it } from "vitest";
import type { PlanViewDto } from "@/lib/api/types.ts";
import { editionColumns, editionsInUse } from "./editions-table.ts";

const edition = (id: string, number: number, priceMinor: number, features: PlanViewDto["current"]["features"]) => ({
  id,
  plan: "SOLO" as const,
  number,
  priceMinor,
  resourceAllowance: 1,
  features,
  publishedAt: "2026-09-01T00:00:00.000Z",
  firstMoveOn: null,
});

const soloV1 = { ...edition("solo-1", 1, 4900, ["REMINDERS"]), current: false, businesses: 12 };
const soloV2 = { ...edition("solo-2", 2, 5900, ["REMINDERS"]), current: true, businesses: 3 };
const solo: PlanViewDto = { plan: "SOLO", current: soloV2, editions: [soloV2, soloV1], pending: null, ifTakenToday: null };
const teamV1 = { ...edition("team-1", 1, 8900, ["REMINDERS", "TEAM_ROLES"]), plan: "TEAM" as const, resourceAllowance: 5, current: true, businesses: 8 };
const team: PlanViewDto = { plan: "TEAM", current: teamV1, editions: [teamV1], pending: null, ifTakenToday: null };

describe("editionColumns", () => {
  it("shows every edition in use, oldest first within a Plan, marking what changed from the one before", () => {
    const columns = editionColumns([solo, team], "IN_USE");
    expect(columns.map((column) => column.id)).toEqual(["solo-1", "solo-2", "team-1"]);
    expect([...(columns[1]?.changed ?? [])]).toEqual(["price"]);
    expect(columns[0]?.changed.size).toBe(0);
    // Another Plan is not "changed" from the last edition of the one before it.
    expect(columns[2]?.changed.size).toBe(0);
  });

  it("shows only what a new Business sees", () => {
    expect(editionColumns([solo, team], "CURRENT").map((column) => column.id)).toEqual(["solo-2", "team-1"]);
  });
});

describe("editionsInUse", () => {
  it("counts editions somebody is on, and the current ones", () => {
    expect(editionsInUse([solo, team])).toBe(3);
  });
});
