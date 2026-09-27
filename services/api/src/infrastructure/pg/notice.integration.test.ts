import { describe, expect, it } from "vitest";
import { parseLocalDate } from "@tor-now/domain";
import { assumeIdentity, createPool, errorCodeOf, type Transaction } from "./client.ts";
import { businessRepository, membershipRepository, userRepository } from "./identity-repositories.ts";
import { noticeRepository } from "./notice-repository.ts";

/**
 * What Row Level Security allows on Notices, which the in-memory double has no
 * way to imitate: an owner keeps Notices of their own acts only, touches
 * nothing of a Notice but when it was read or cleared, and nobody else sees
 * them. Each case rolls back.
 */
const databaseUrl = process.env["TEST_DATABASE_URL"];

class RollBack extends Error {}

const INSUFFICIENT_PRIVILEGE = "42501";

const inRolledBackTransaction = async (body: (tx: Transaction) => Promise<void>) => {
  const sql = createPool(databaseUrl ?? "");
  try {
    await sql.begin(async (tx) => {
      await body(tx as Transaction);
      throw new RollBack();
    });
  } catch (error) {
    if (!(error instanceof RollBack)) throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/** Runs `attempt` in a savepoint and returns the Postgres error code it raised. */
const refusal = async (tx: Transaction, attempt: (tx: Transaction) => Promise<unknown>) => {
  try {
    await tx.savepoint((inner) => attempt(inner as Transaction));
  } catch (error) {
    return errorCodeOf(error);
  }
  return null;
};

const aShopAndItsOwner = async (tx: Transaction, suffix: string) => {
  const owner = await userRepository(tx).create({
    phone: `+97250009${suffix}`,
    givenName: "בעלים",
    familyName: null,
    birthDate: null,
  });
  const business = await businessRepository(tx).create({
    name: `עסק ${suffix}`,
    phone: `+97250009${suffix}`,
    timeZone: "Asia/Jerusalem",
    description: null,
    address: null,
    latitude: 32.0853,
    longitude: 34.7818,
    category: null,
  });
  await membershipRepository(tx).create(owner.id, business.id, "OWNER");
  return { owner, business };
};

describe.skipIf(databaseUrl === undefined || databaseUrl === "")("Notices under RLS (postgres)", () => {
  it("lets an owner keep a Notice of their own act, and nothing about paying", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { owner, business } = await aShopAndItsOwner(tx, "4101");
      await assumeIdentity(tx, { kind: "USER", userId: owner.id });

      const paid = await refusal(tx, (inner) =>
        noticeRepository(inner).post({
          businessId: business.id,
          facts: { kind: "PAYMENT_RECORDED", paidThrough: parseLocalDate("2031-04-01") },
          key: null,
        }),
      );
      expect(paid).toBe(INSUFFICIENT_PRIVILEGE);

      const resumed = await noticeRepository(tx).post({
        businessId: business.id,
        facts: { kind: "CALENDARS_RESUMED", names: ["יומן"] },
        key: null,
      });
      expect(resumed?.facts.kind).toBe("CALENDARS_RESUMED");
    });
  });

  it("never lets an owner rewrite what a Notice said", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { owner, business } = await aShopAndItsOwner(tx, "4102");
      const kept = await noticeRepository(tx).post({
        businessId: business.id,
        facts: { kind: "DEACTIVATED", on: parseLocalDate("2031-03-10") },
        key: "DEACTIVATED:2031-03-10",
      });
      await assumeIdentity(tx, { kind: "USER", userId: owner.id });

      const rewritten = await refusal(
        tx,
        (inner) => inner`update notice set facts = '{"kind":"DEACTIVATED","on":"2000-01-01"}' where id = ${kept?.id ?? ""}`,
      );
      expect(rewritten).toBe(INSUFFICIENT_PRIVILEGE);
      const deleted = await refusal(tx, (inner) => inner`delete from notice where id = ${kept?.id ?? ""}`);
      expect(deleted).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("shows a Business's Notices to its owner and nobody else", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { owner, business } = await aShopAndItsOwner(tx, "4103");
      const stranger = await aShopAndItsOwner(tx, "4104");
      await noticeRepository(tx).post({
        businessId: business.id,
        facts: { kind: "TRIAL_ENDING", trialEndsOn: parseLocalDate("2031-03-20") },
        key: "TRIAL_ENDING:2031-03-20",
      });

      await assumeIdentity(tx, { kind: "USER", userId: stranger.owner.id });
      expect(await noticeRepository(tx).listForBusiness(business.id, 10)).toEqual([]);

      await assumeIdentity(tx, { kind: "USER", userId: owner.id });
      expect(await noticeRepository(tx).listForBusiness(business.id, 10)).toHaveLength(1);
    });
  });
});
