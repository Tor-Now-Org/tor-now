import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { mayReview } from "./review.ts";

describe("reviews", () => {
  const endAt = instant(1_000);
  const before = instant(999);
  const after = instant(1_000);

  it("needs a confirmed appointment that has ended", () => {
    expect(mayReview([], after)).toBe(false);
    expect(mayReview([{ status: "CANCELLED", endAt }, { status: "NO_SHOW", endAt }], after)).toBe(false);
    expect(mayReview([{ status: "CONFIRMED", endAt }], before)).toBe(false);
    expect(mayReview([{ status: "CANCELLED", endAt }, { status: "CONFIRMED", endAt }], after)).toBe(true);
  });
});
