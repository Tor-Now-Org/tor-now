import { describe, expect, it } from "vitest";
import { MAXIMUM_PHOTOS, PHOTO_SLOTS, freeSlots, isCover } from "./business.ts";
import type { PhotoSlot } from "./business.ts";

describe("photo slots", () => {
  it("offers four in total: the cover and three more", () => {
    expect(MAXIMUM_PHOTOS).toBe(4);
    expect(freeSlots([])).toEqual([
      PHOTO_SLOTS.cover,
      PHOTO_SLOTS.firstExtra,
      2,
      PHOTO_SLOTS.lastExtra,
    ]);
  });

  it("only slot zero is the cover", () => {
    expect(isCover(PHOTO_SLOTS.cover)).toBe(true);
    expect(isCover(1)).toBe(false);
  });

  it("offers what is left, keeping the order the slots are shown in", () => {
    expect(freeSlots([1, 3])).toEqual([0, 2]);
  });

  it("offers nothing once every slot is taken", () => {
    const all = [0, 1, 2, 3] as PhotoSlot[];
    expect(freeSlots(all)).toEqual([]);
  });

  it("a business with a cover and no others can still add three", () => {
    expect(freeSlots([PHOTO_SLOTS.cover])).toHaveLength(3);
  });
});
