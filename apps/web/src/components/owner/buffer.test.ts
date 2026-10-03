import { describe, expect, it } from "vitest";
import { bufferOf, followersOf } from "./buffer.ts";

describe("a service's recovery time", () => {
  it("follows the business when the service sets none, and says how long that is", () => {
    expect(bufferOf(null, 10)).toEqual({ minutes: 10, follows: true });
    expect(bufferOf(null, 0)).toEqual({ minutes: 0, follows: true });
  });

  it("is its own when the service sets one — nought included, which means none", () => {
    expect(bufferOf(15, 10)).toEqual({ minutes: 15, follows: false });
    expect(bufferOf(0, 10)).toEqual({ minutes: 0, follows: false });
  });
});

describe("the services the business default reaches", () => {
  const services = [
    { id: "a", name: "תספורת", bufferMinutes: null, active: true },
    { id: "b", name: "צבע ופן", bufferMinutes: 15, active: true },
    { id: "c", name: "פן", bufferMinutes: null, active: false },
  ];

  it("names each offered service with the time it keeps, and whose time it is", () => {
    expect(followersOf(services, 10)).toEqual([
      { id: "a", name: "תספורת", minutes: 10, follows: true },
      { id: "b", name: "צבע ופן", minutes: 15, follows: false },
    ]);
  });

  it("leaves out a hidden service, which no customer can book", () => {
    expect(followersOf(services, 10).map((one) => one.id)).not.toContain("c");
  });
});
