import { describe, expect, it } from "vitest";
import { MAXIMUM_PHOTOS, PHOTO_SLOTS, PHOTO_SLOTS_IN_ORDER } from "./business.ts";

describe("photo slots", () => {
  it("offers four in total: the cover and three more", () => {
    expect(MAXIMUM_PHOTOS).toBe(4);
    expect(PHOTO_SLOTS_IN_ORDER).toEqual([0, 1, 2, 3]);
  });

  it("names the cover and the range the rest occupy", () => {
    expect(PHOTO_SLOTS.cover).toBe(0);
    expect(PHOTO_SLOTS.firstExtra).toBe(1);
    expect(PHOTO_SLOTS.lastExtra).toBe(MAXIMUM_PHOTOS - 1);
  });

  it("leads with the cover, which is what every screen renders first", () => {
    expect(PHOTO_SLOTS_IN_ORDER[0]).toBe(PHOTO_SLOTS.cover);
  });
});
