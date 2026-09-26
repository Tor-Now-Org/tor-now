import { describe, expect, it } from "vitest";
import { NO_DIRECTORY_FILTER, type DirectoryFilter } from "@/lib/api/types.ts";
import {
  choicesMade,
  choosePlan,
  resetChoices,
  toggleFlag,
  toggleStatus,
  tokensOf,
  withoutToken,
} from "./directory-filter.ts";

const chosen: DirectoryFilter = {
  query: "רן",
  statuses: ["TRIAL", "IN_GRACE"],
  plan: "TEAM",
  flags: ["TRIAL_ENDING"],
};

describe("the directory filter", () => {
  it("adds a status on the first tap and takes it away on the second", () => {
    const once = toggleStatus(NO_DIRECTORY_FILTER, "TRIAL");
    expect(once.statuses).toEqual(["TRIAL"]);
    expect(toggleStatus(once, "TRIAL").statuses).toEqual([]);
  });

  it("toggles a flag the same way", () => {
    const once = toggleFlag(NO_DIRECTORY_FILTER, "MOVE_PENDING");
    expect(once.flags).toEqual(["MOVE_PENDING"]);
    expect(toggleFlag(once, "MOVE_PENDING").flags).toEqual([]);
  });

  it("counts every choice in the panel, but not the search", () => {
    expect(choicesMade(NO_DIRECTORY_FILTER)).toBe(0);
    expect(choicesMade(chosen)).toBe(4);
  });

  it("resets the panel's choices and keeps what was typed", () => {
    expect(resetChoices(chosen)).toEqual({ ...NO_DIRECTORY_FILTER, query: "רן" });
  });

  it("gives one token per choice, and removing one takes only its own", () => {
    const tokens = tokensOf(chosen);
    expect(tokens.map((token) => token.value)).toEqual(["TRIAL", "IN_GRACE", "TEAM", "TRIAL_ENDING"]);

    const [, grace, plan] = tokens;
    if (grace === undefined || plan === undefined) throw new Error("expected tokens");
    expect(withoutToken(chosen, grace).statuses).toEqual(["TRIAL"]);
    expect(withoutToken(chosen, plan)).toEqual(choosePlan(chosen, null));
  });

  it("never changes the filter it was given", () => {
    const before = JSON.stringify(chosen);
    toggleStatus(chosen, "PAID");
    toggleFlag(chosen, "OVER_ALLOWANCE");
    resetChoices(chosen);
    expect(JSON.stringify(chosen)).toBe(before);
  });
});
