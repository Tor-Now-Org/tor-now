import { describe, expect, it } from "vitest";
import { LONGEST_BLOCKAGE_IN_DAYS, spansOf } from "./blockage.ts";

const JERUSALEM = "Asia/Jerusalem";
const away = {
  from: "2026-09-07",
  to: "2026-09-09",
  allDay: true,
  ranges: [],
  reason: "חופשה",
};

describe("a blockage, as intervals", () => {
  it("is one interval per day of a holiday, not one long one", () => {
    const spans = spansOf(away, JERUSALEM);

    // Three days, each its own block, so a day of the holiday can be given
    // back without unpicking the rest.
    expect(spans).toHaveLength(3);
    expect(spans[0]?.startAt).toBe("2026-09-06T21:00:00.000Z");
    expect(spans[2]?.startAt).toBe("2026-09-08T21:00:00.000Z");
    expect(spans.every((span) => span.reason === "חופשה")).toBe(true);
  });

  it("is one interval for the ordinary blockage of one afternoon", () => {
    const spans = spansOf(
      {
        from: "2026-09-07",
        to: "2026-09-07",
        allDay: false,
        ranges: [{ start: "13:00", end: "14:00" }],
        reason: "",
      },
      JERUSALEM,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      startAt: "2026-09-07T10:00:00.000Z",
      endAt: "2026-09-07T11:00:00.000Z",
    });
  });

  it("multiplies the hours across the days, for an hour kept free all week", () => {
    const spans = spansOf(
      {
        from: "2026-09-07",
        to: "2026-09-11",
        allDay: false,
        ranges: [
          { start: "08:00", end: "09:00" },
          { start: "13:00", end: "14:00" },
        ],
        reason: "",
      },
      JERUSALEM,
    );

    expect(spans).toHaveLength(10);
  });

  it("merges hours that run together rather than blocking twice over", () => {
    const spans = spansOf(
      {
        from: "2026-09-07",
        to: "2026-09-07",
        allDay: false,
        ranges: [
          { start: "09:00", end: "13:00" },
          { start: "12:00", end: "15:00" },
        ],
        reason: "",
      },
      JERUSALEM,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]?.endAt).toBe("2026-09-07T12:00:00.000Z");
  });

  it("stops at a length no honest blockage reaches", () => {
    // A slip in a date field should not be able to fill a table.
    const spans = spansOf({ ...away, to: "2027-09-07" }, JERUSALEM);
    expect(spans).toHaveLength(LONGEST_BLOCKAGE_IN_DAYS);
  });

  it("is nothing at all when the range runs backwards", () => {
    expect(spansOf({ ...away, from: "2026-09-09", to: "2026-09-07" }, JERUSALEM)).toEqual([]);
  });
});
