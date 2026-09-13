import { describe, expect, it } from "vitest";
import { absorbBlockages } from "./blockage.ts";
import { interval } from "../time/interval.ts";
import { parseInstant } from "../time/instant.ts";

const at = (time: string) => parseInstant(`2026-09-15T${time}:00.000Z`);
const span = (from: string, to: string) => interval(at(from), at(to));
const block = (id: string, from: string, to: string) => ({
  id,
  startAt: at(from),
  endAt: at(to),
});

describe("blocking out time that is already blocked", () => {
  it("leaves an unrelated blockage alone", () => {
    const { removed, spans } = absorbBlockages(
      [block("morning", "08:00", "09:00")],
      [span("14:00", "15:00")],
    );
    expect(removed).toEqual([]);
    expect(spans).toEqual([span("14:00", "15:00")]);
  });

  it("swallows one that the new blockage covers entirely", () => {
    const { removed, spans } = absorbBlockages(
      [block("afternoon", "14:00", "16:00")],
      [span("09:00", "18:00")],
    );
    expect(removed.map((one) => one.id)).toEqual(["afternoon"]);
    expect(spans).toEqual([span("09:00", "18:00")]);
  });

  it("grows to cover one it only partly meets", () => {
    const { removed, spans } = absorbBlockages(
      [block("afternoon", "14:00", "18:00")],
      [span("12:00", "15:00")],
    );
    expect(removed.map((one) => one.id)).toEqual(["afternoon"]);
    expect(spans).toEqual([span("12:00", "18:00")]);
  });

  it("treats a blockage that ends where the new one starts as the same run", () => {
    // Two till four and four till six is one afternoon kept free, not two
    // blockages that happen to be adjacent.
    const { removed, spans } = absorbBlockages(
      [block("early", "14:00", "16:00")],
      [span("16:00", "18:00")],
    );
    expect(removed.map((one) => one.id)).toEqual(["early"]);
    expect(spans).toEqual([span("14:00", "18:00")]);
  });

  it("draws in a blockage that only the growing run reaches", () => {
    // The new one meets the first, and the first extends the run far enough to
    // reach the second — which a single pass would have walked straight past.
    const { removed } = absorbBlockages(
      [block("far", "17:00", "19:00"), block("near", "15:00", "17:30")],
      [span("14:00", "15:30")],
    );
    expect(removed.map((one) => one.id).sort()).toEqual(["far", "near"]);
  });

  it("keeps separate runs separate", () => {
    const { removed, spans } = absorbBlockages(
      [block("morning", "08:00", "09:00")],
      [span("08:30", "09:30"), span("14:00", "15:00")],
    );
    expect(removed.map((one) => one.id)).toEqual(["morning"]);
    expect(spans).toEqual([span("08:00", "09:30"), span("14:00", "15:00")]);
  });

  it("has nothing to absorb when the calendar is empty", () => {
    const { removed, spans } = absorbBlockages([], [span("09:00", "10:00")]);
    expect(removed).toEqual([]);
    expect(spans).toEqual([span("09:00", "10:00")]);
  });

  it("merges the wanted spans among themselves as well", () => {
    const { spans } = absorbBlockages([], [span("09:00", "11:00"), span("10:00", "12:00")]);
    expect(spans).toEqual([span("09:00", "12:00")]);
  });
});
