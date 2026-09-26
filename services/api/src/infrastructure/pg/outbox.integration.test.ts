import { describe, expect, it } from "vitest";
import { asId } from "@tor-now/domain";
import { TEMPLATES } from "../../ports/notifier.ts";
import { createPool, type Transaction } from "./client.ts";
import { outbox } from "./outbox.ts";

/**
 * The outbox's own SQL, against a real Postgres. Its callers are all tested
 * through the in-memory double, so this is the one place the statements — and
 * the enqueue function's argument order — actually run. Each case rolls back.
 */
const databaseUrl = process.env["TEST_DATABASE_URL"];

class RollBack extends Error {}

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

describe.skipIf(databaseUrl === undefined || databaseUrl === "")("the outbox (postgres)", () => {
  it("keeps whose message it is from enqueue to delivery", async () => {
    await inRolledBackTransaction(async (tx) => {
      const [business] = await tx<{ id: string }[]>`
        insert into business (name, phone) values ('עסק לבדיקה', '+972500009901') returning id`;
      if (business === undefined) throw new Error("no business");
      const box = outbox(tx);

      await box.enqueue({
        businessId: asId(business.id),
        recipientPhone: "+972500009902",
        template: TEMPLATES.bookingConfirmed,
        payload: {
          businessName: "עסק לבדיקה",
          businessPhone: "+972500009901",
          serviceName: "תספורת",
          customerName: "דנה",
          startAt: "2031-03-10T10:00:00.000Z",
        },
      });

      const claimed = await box.claimPending(100);
      const mine = claimed.find((entry) => entry.message.recipientPhone === "+972500009902");
      expect(mine?.message.businessId).toBe(business.id);
      expect(mine?.message.template).toBe("BOOKING_CONFIRMED");

      await box.markSent(mine?.id ?? "", "WHATSAPP");
      const [row] = await tx<{ status: string; delivered_via: string }[]>`
        select status, delivered_via from notification_outbox where id = ${mine?.id ?? ""}`;
      expect(row).toEqual({ status: "SENT", delivered_via: "WHATSAPP" });
    });
  });
});
