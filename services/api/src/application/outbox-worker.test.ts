import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@tor-now/domain";
import { OUTBOX } from "../config.ts";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

/**
 * The worker that ADR 0005 puts between an event and its message.
 *
 * The path was only ever exercised sideways, by a reminder test that happened
 * to drain it, so nothing said what happens when a provider refuses — which is
 * the case the outbox exists for.
 */
describe("draining the outbox", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  const aBooking = async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
  };

  it("delivers what a booking enqueued, and says what it did", async () => {
    await aBooking();

    const report = await test.services.outboxWorker.drain();

    expect(report).toMatchObject({ claimed: 1, delivered: 1, failed: 0, abandoned: 0 });
    expect(test.deliveredTemplates).toEqual(["BOOKING_CONFIRMED"]);
    expect(test.store.outbox[0]?.status).toBe("SENT");
  });

  it("leaves a refused message pending, and waits before trying again", async () => {
    await aBooking();
    test.refuseDeliveries("provider said no");

    const report = await test.services.outboxWorker.drain();
    expect(report).toMatchObject({ claimed: 1, delivered: 0, failed: 1, abandoned: 0 });
    expect(test.store.outbox[0]?.status).toBe("PENDING");

    // The cron ticks every minute. Without a wait, that is every attempt spent
    // inside five minutes of an outage that usually lasts longer.
    const second = await test.services.outboxWorker.drain();
    expect(second.claimed).toBe(0);
  });

  it("tries again once the wait has passed", async () => {
    await aBooking();
    test.refuseDeliveries("provider said no");
    await test.services.outboxWorker.drain();

    const [firstWait] = OUTBOX.retryAfterMinutes;
    test.travelTo(
      parseInstant(new Date(Date.now() + (firstWait + 1) * 60_000).toISOString()),
    );
    test.refuseDeliveries(null);

    const report = await test.services.outboxWorker.drain();
    expect(report).toMatchObject({ claimed: 1, delivered: 1 });
    expect(test.store.outbox[0]?.status).toBe("SENT");
  });

  it("gives up after the last attempt rather than retrying for ever", async () => {
    await aBooking();
    test.refuseDeliveries("provider said no");

    for (let attempt = 0; attempt < OUTBOX.maxAttempts; attempt += 1) {
      // Each drain waits, so the clock has to move for the next one to claim.
      test.travelTo(parseInstant(new Date(Date.now() + attempt * 3_600_000).toISOString()));
      await test.services.outboxWorker.drain();
    }

    const entry = test.store.outbox[0];
    expect(entry?.status).toBe("FAILED");
    expect(entry?.attempts).toBe(OUTBOX.maxAttempts);
  });

  it("delivers nothing when there is nothing to deliver", async () => {
    expect(await test.services.outboxWorker.drain()).toMatchObject({
      claimed: 0,
      delivered: 0,
    });
  });
});
