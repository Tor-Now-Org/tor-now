import { describe, expect, it, vi } from "vitest";
import { api } from "./api/client.ts";
import { businessToManage, fetchBusinesses } from "./last-managed.ts";

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

describe("asking for the businesses", () => {
  it("joins a request in flight, and asks afresh once it has answered", async () => {
    const asked = vi.spyOn(api, "myBusinesses").mockResolvedValue([]);
    const first = fetchBusinesses("t", { join: true });
    // `/` asked, then /manage arrived while the answer was still out.
    expect(fetchBusinesses("t", { join: true })).toBe(first);
    // A reload after a change is never answered from before it.
    const reload = fetchBusinesses("t");
    expect(reload).not.toBe(first);
    expect(fetchBusinesses("other", { join: true })).not.toBe(reload);
    expect(asked).toHaveBeenCalledTimes(3);
    await reload;
    await new Promise((settle) => setTimeout(settle, 0));
    void fetchBusinesses("t", { join: true });
    expect(asked).toHaveBeenCalledTimes(4);
    asked.mockRestore();
  });
});
