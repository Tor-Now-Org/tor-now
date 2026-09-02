import { describe, expect, it } from "vitest";
import { hasStarted, outcomeOf } from "./outcome.ts";
import { parseInstant } from "../time/instant.ts";

const AT = (iso: string) => parseInstant(iso);

const appointment = (status: "CONFIRMED" | "CANCELLED" | "NO_SHOW") => ({
  status,
  startAt: AT("2026-09-02T10:00:00Z"),
  endAt: AT("2026-09-02T10:30:00Z"),
});

describe("what became of an appointment", () => {
  it("is upcoming until it has ended", () => {
    expect(outcomeOf(appointment("CONFIRMED"), AT("2026-09-02T09:00:00Z"))).toBe("UPCOMING");
  });

  it("is still upcoming while it is happening", () => {
    // The customer is in the chair; calling that finished would be wrong in
    // front of both of them.
    expect(outcomeOf(appointment("CONFIRMED"), AT("2026-09-02T10:15:00Z"))).toBe("UPCOMING");
  });

  it("is finished the moment it ends, with nobody marking it", () => {
    expect(outcomeOf(appointment("CONFIRMED"), AT("2026-09-02T10:30:00Z"))).toBe("FINISHED");
    expect(outcomeOf(appointment("CONFIRMED"), AT("2026-09-03T00:00:00Z"))).toBe("FINISHED");
  });

  it("keeps what somebody decided over what the clock says", () => {
    const long_after = AT("2026-09-09T00:00:00Z");
    expect(outcomeOf(appointment("CANCELLED"), long_after)).toBe("CANCELLED");
    expect(outcomeOf(appointment("NO_SHOW"), long_after)).toBe("NO_SHOW");
  });

  it("a cancellation made before the time still reads as cancelled after it", () => {
    expect(outcomeOf(appointment("CANCELLED"), AT("2026-09-02T09:00:00Z"))).toBe("CANCELLED");
  });
});

describe("whether it has started", () => {
  it("is false before, and true from the first moment on", () => {
    expect(hasStarted(appointment("CONFIRMED"), AT("2026-09-02T09:59:59Z"))).toBe(false);
    expect(hasStarted(appointment("CONFIRMED"), AT("2026-09-02T10:00:00Z"))).toBe(true);
  });

  it("is true while it is happening, when finished is still false", () => {
    const midway = AT("2026-09-02T10:15:00Z");
    expect(hasStarted(appointment("CONFIRMED"), midway)).toBe(true);
    expect(outcomeOf(appointment("CONFIRMED"), midway)).toBe("UPCOMING");
  });
});
