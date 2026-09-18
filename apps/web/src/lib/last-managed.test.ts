import { describe, expect, it } from "vitest";
import { businessToManage } from "./last-managed.ts";

const shop = (id: string) => ({ id });

describe("which business the switch opens", () => {
  it("is the one they were last in", () => {
    expect(businessToManage([shop("a"), shop("b")], "b")?.id).toBe("b");
  });

  it("is the first one on a device that has never managed anything", () => {
    // A new phone has no memory, and asking would cost the tap this whole
    // design exists to save.
    expect(businessToManage([shop("a"), shop("b")], null)?.id).toBe("a");
  });

  it("is the first one when the remembered business is no longer theirs", () => {
    // Businesses are left and closed. A remembered id that matches nothing
    // must not become a switch that opens onto nothing.
    expect(businessToManage([shop("a"), shop("b")], "gone")?.id).toBe("a");
  });

  it("is nothing at all when they staff nothing", () => {
    expect(businessToManage([], "a")).toBeNull();
    expect(businessToManage([], null)).toBeNull();
  });

  it("is the only one there is, whatever was remembered", () => {
    expect(businessToManage([shop("only")], "gone")?.id).toBe("only");
  });
});
