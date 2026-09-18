import { beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@tor-now/domain";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness, TUESDAY_AT } from "../infrastructure/testing/scenarios.ts";

describe("reviewing a business", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("is refused to somebody who has no confirmed appointment there", async () => {
    const shop = await anEstablishedBusiness(test);
    const stranger = await signIn(test, "+972500000002", "דנה");

    expect(await test.services.reviews.forBusiness(stranger.actor, shop.business.id)).toMatchObject({
      mayReview: false,
      mine: null,
    });
    await expect(
      test.services.reviews.write(stranger.actor, shop.business.id, { stars: 5, comment: "", anonymous: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is written once by a customer and edited in place after", async () => {
    const shop = await anEstablishedBusiness(test);
    const customer = await signIn(test, "+972500000002", "דנה");
    await test.services.booking.book(customer.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });

    // Booked but not yet been: no review until the appointment has ended.
    await expect(
      test.services.reviews.write(customer.actor, shop.business.id, {
        stars: 5,
        comment: "",
        anonymous: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    test.travelTo(parseInstant(TUESDAY_AT("09:30")));

    const first = await test.services.reviews.write(customer.actor, shop.business.id, {
      stars: 3,
      comment: "בסדר",
      anonymous: false,
    });
    await test.services.reviews.write(customer.actor, shop.business.id, {
      stars: 5,
      comment: "מעולה",
      anonymous: true,
    });

    const seen = await test.services.reviews.forBusiness(customer.actor, shop.business.id);
    expect(seen.mayReview).toBe(true);
    expect(seen.reviews).toHaveLength(1);
    expect(seen.mine).toMatchObject({ id: first.id, stars: 5, comment: "מעולה", anonymous: true });
    // Nobody reading the business learns who wrote an anonymous review.
    expect(seen.reviews[0]).toMatchObject({ authorName: null, customerId: null });
    expect(test.store.audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["REVIEW_SUBMITTED", "REVIEW_EDITED"]),
    );
  });

  it("lets an administrator who has been a customer review like anybody else", async () => {
    const shop = await anEstablishedBusiness(test);
    const operator = await signIn(test, "+972500000003", "נועה");
    await test.services.booking.book(operator.actor, {
      businessId: shop.business.id,
      serviceId: shop.service.id,
      resourceId: shop.resource.id,
      startAt: TUESDAY_AT("09:00"),
      customerNote: null,
    });
    test.travelTo(parseInstant(TUESDAY_AT("09:30")));

    expect(
      await test.services.reviews.forBusiness(operator.administrator, shop.business.id),
    ).toMatchObject({ mayReview: true });
    await test.services.reviews.write(operator.administrator, shop.business.id, {
      stars: 4,
      comment: "",
      anonymous: false,
    });
  });
});
