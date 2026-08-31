import { beforeEach, describe, expect, it } from "vitest";
import { instant } from "@tor-now/domain";
import { VERIFICATION } from "../config.ts";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";

/**
 * ADR 0004: registering and signing in are the same act, and the code is the
 * whole credential — so the limits around issuing and checking it are the whole
 * of the platform's authentication security.
 */
describe("verification", () => {
  let test: Harness;
  const phone = "+972500000042";

  beforeEach(() => {
    test = harness();
  });

  it("creates a user for a number it has never seen", async () => {
    const result = await test.services.auth.requestCode(phone);
    expect(result.expiresInSeconds).toBe(VERIFICATION.lifetimeSeconds);

    const session = await test.services.auth.verifyCode(phone, "111111", "חדש");
    expect(session.isNewUser).toBe(true);
    expect(session.user.phone).toBe(phone);
  });

  it("signs in a number it already knows, without creating a second user", async () => {
    await signIn(test, phone, "ראשון");
    const again = await signIn(test, phone, "מתעלמים");

    expect(test.store.users.filter((user) => user.phone === phone)).toHaveLength(1);
    // The name from the first sign-in is kept; a later one does not rewrite it.
    expect(again.user.name).toBe("ראשון");
  });

  it("refuses a wrong code and counts the attempt against that code", async () => {
    await test.services.auth.requestCode(phone);
    await expect(
      test.services.auth.verifyCode(phone, "000000", null),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(test.store.verificationCodes[0]?.attempts).toBe(1);
  });

  it("stops accepting a code after too many attempts", async () => {
    await test.services.auth.requestCode(phone);
    for (let attempt = 0; attempt < VERIFICATION.maxAttemptsPerCode; attempt += 1) {
      await expect(
        test.services.auth.verifyCode(phone, "000000", null),
      ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    }
    // Even the right code is refused now; a new one has to be asked for.
    await expect(
      test.services.auth.verifyCode(phone, "111111", null),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });

  it("refuses to reuse a code that has already been spent", async () => {
    await signIn(test, phone);
    await expect(
      test.services.auth.verifyCode(phone, "111111", null),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });

  it("refuses a code that has expired", async () => {
    await test.services.auth.requestCode(phone);
    test.travelTo(instant(test.clock.now() + (VERIFICATION.lifetimeSeconds + 1) * 1000));
    await expect(
      test.services.auth.verifyCode(phone, "111111", null),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });

  it("rate limits how many codes one number may ask for", async () => {
    for (let issued = 0; issued < VERIFICATION.maxCodesPerPhonePerWindow; issued += 1) {
      await test.services.auth.requestCode(phone);
    }
    await expect(test.services.auth.requestCode(phone)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("never stores the code itself", async () => {
    await test.services.auth.requestCode(phone);
    const stored = JSON.stringify(test.store.verificationCodes);
    expect(stored).not.toContain("111111");
  });

  it("grants administrator only when the flag and the allowlist agree", async () => {
    const person = await signIn(test, phone);

    // The flag alone is not enough (ADR 0010).
    test.store.users = test.store.users.map((user) =>
      user.id === person.user.id ? { ...user, isAdministrator: true } : user,
    );
    const withFlagOnly = await signIn(test, phone);
    expect(withFlagOnly.user.isAdministrator).toBe(true);
    expect(test.tokens.verify(withFlagOnly.token)).resolves.toMatchObject({
      isAdministrator: false,
    });

    // With the number on the allowlist as well, the session carries it.
    test.store.allowlist = [{ phone, note: null }];
    const withBoth = await signIn(test, phone);
    await expect(test.tokens.verify(withBoth.token)).resolves.toMatchObject({
      isAdministrator: true,
    });
  });

  it("refuses a closed account rather than quietly reopening it", async () => {
    const person = await signIn(test, phone);
    await test.services.profile.deleteAccount(person.actor);

    await test.services.auth.requestCode(phone);
    await expect(
      test.services.auth.verifyCode(phone, "111111", null),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the person's own profile", () => {
  it("updates the name everywhere at once, because it belongs to them", async () => {
    const test = harness();
    const person = await signIn(test, "+972500000042", "לפני");
    const updated = await test.services.profile.updateProfile(person.actor, {
      name: "אחרי",
      birthDate: "1990-04-01",
    });
    expect(updated.name).toBe("אחרי");
    expect(updated.birthDate).toBe("1990-04-01");
    expect(test.store.audit.some((entry) => entry.action === "USER_UPDATED")).toBe(true);
  });

  it("refuses to close the account of someone who owns a business", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    await expect(
      test.services.profile.deleteAccount(shop.owner.actor),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hides a closed account without destroying its history", async () => {
    const test = harness();
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: (await import("../infrastructure/testing/scenarios.ts")).TUESDAY_AT("09:00"),
      customerNote: null,
    });

    await test.services.profile.deleteAccount(customer.actor);

    // ADR 0008: the appointment survives, and the business keeps its record.
    expect(test.store.appointments).toHaveLength(1);
    const stored = test.store.users.find((user) => user.id === customer.user.id);
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.phone).toBe("+972500000002");
  });
});
