import { describe, expect, it } from "vitest";
import type { CalendarAppointmentDto } from "@/lib/api/types.ts";
import { IDLE, answerTo, hasFailed, isPending, wantsAnswer, type Search } from "./day-search.ts";

const appointment = (id: string) => ({ id }) as unknown as CalendarAppointmentDto;
const found = (of: string, ...ids: string[]): Search => ({
  state: "found",
  of,
  matches: ids.map(appointment),
});

describe("whether a query is worth asking", () => {
  it("wants two characters", () => {
    expect(wantsAnswer("")).toBe(false);
    expect(wantsAnswer("י")).toBe(false);
    expect(wantsAnswer("יע")).toBe(true);
  });

  it("does not count the spaces around it", () => {
    expect(wantsAnswer("  י  ")).toBe(false);
    expect(wantsAnswer("  יע  ")).toBe(true);
  });
});

describe("the answer shown under a query", () => {
  it("is the matches, when they answer that query", () => {
    expect(answerTo(found("יעל", "a", "b"), "יעל")).toHaveLength(2);
  });

  it("ignores the spaces the reader typed around it", () => {
    expect(answerTo(found("יעל", "a"), " יעל ")).toHaveLength(1);
  });

  it("is nothing while a newer query has no answer yet", () => {
    // The bug this exists to stop: "יע" has an answer, "יעל" does not yet, and
    // the screen drew the first as though it were the second.
    expect(answerTo(found("יע", "a", "b"), "יעל")).toBeNull();
  });

  it("is nothing for a query still being asked", () => {
    expect(answerTo({ state: "searching", of: "יעל" }, "יעל")).toBeNull();
  });

  it("is nothing when the request failed", () => {
    // Not an empty list: an empty list is an answer, and this is the absence
    // of one. Drawing "no matches" over a dropped request is a lie about the
    // customer's appointments.
    expect(answerTo({ state: "failed", of: "יעל" }, "יעל")).toBeNull();
  });

  it("is an empty list when that is genuinely the answer", () => {
    expect(answerTo(found("יעל"), "יעל")).toEqual([]);
  });

  it("is nothing at all before anything has been asked", () => {
    expect(answerTo(IDLE, "יעל")).toBeNull();
  });
});

describe("when the screen owes a spinner", () => {
  it("does while the answer belongs to an older query", () => {
    expect(isPending(found("יע", "a"), "יעל")).toBe(true);
  });

  it("does while this query is in flight", () => {
    expect(isPending({ state: "searching", of: "יעל" }, "יעל")).toBe(true);
  });

  it("does not once this query is answered", () => {
    expect(isPending(found("יעל", "a"), "יעל")).toBe(false);
  });

  it("does not for a query too short to ask", () => {
    expect(isPending(IDLE, "י")).toBe(false);
  });

  it("does not when this query failed — that is an answer of its own", () => {
    expect(isPending({ state: "failed", of: "יעל" }, "יעל")).toBe(false);
  });
});

describe("when the search failed", () => {
  it("is said of the query that failed", () => {
    expect(hasFailed({ state: "failed", of: "יעל" }, "יעל")).toBe(true);
  });

  it("is not carried over to the next query", () => {
    expect(hasFailed({ state: "failed", of: "יע" }, "יעל")).toBe(false);
  });
});
