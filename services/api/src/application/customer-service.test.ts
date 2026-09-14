import { beforeEach, describe, expect, it } from "vitest";
import { harness, signIn, type Harness } from "../infrastructure/testing/harness.ts";
import { anEstablishedBusiness } from "../infrastructure/testing/scenarios.ts";

/**
 * Writing somebody down so they can be booked in.
 *
 * A Business taking a booking over the telephone knows a number and a name and
 * nothing else. The number may belong to somebody who has signed in, somebody
 * who has not, or somebody who already works there — and the three have to end
 * differently.
 */
describe("adding a customer by their number", () => {
  let test: Harness;

  beforeEach(() => {
    test = harness();
  });

  it("creates the person when the number has never signed in", async () => {
    const shop = await anEstablishedBusiness(test);

    const customer = await test.services.calendar.addCustomer(
      shop.owner.actor,
      shop.business.id,
      { phone: "+972500000009", givenName: "אביגיל", familyName: "נוי" },
    );

    expect(customer.user.phone).toBe("+972500000009");
    expect(customer.membership?.role).toBe("CUSTOMER");
    // The name the Business gave them is kept apart from the one they will
    // give themselves, exactly as an invitation keeps it.
    expect(customer.membership?.invitedGivenName).toBe("אביגיל");
  });

  it("finds somebody who has signed in, rather than making a second of them", async () => {
    const shop = await anEstablishedBusiness(test);
    const her = await signIn(test, "+972500000002", "דנה כהן");

    const customer = await test.services.calendar.addCustomer(
      shop.owner.actor,
      shop.business.id,
      { phone: "+972500000002", givenName: "משהו אחר", familyName: null },
    );

    expect(customer.user.id).toBe(her.user.id);
    // Her own name stands. What somebody typed at a desk does not overwrite
    // the name she gave herself.
    expect(customer.user.givenName).toBe("דנה");
  });

  it("does not demote a colleague who rings up for a haircut", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000007",
      givenName: "שימי",
      role: "WORKER",
      resourceIds: [shop.resource.id],
    });

    const customer = await test.services.calendar.addCustomer(
      shop.owner.actor,
      shop.business.id,
      { phone: "+972500000007", givenName: "שימי", familyName: null },
    );

    // `ensureCustomer` only creates a Membership that is missing. Using the
    // invitation path here instead would have rewritten the role, and booking
    // a colleague a haircut would have taken away their calendar.
    expect(customer.membership?.role).toBe("WORKER");
  });

  it("is the same person on a second attempt, not a second membership", async () => {
    const shop = await anEstablishedBusiness(test);
    const first = await test.services.calendar.addCustomer(
      shop.owner.actor,
      shop.business.id,
      { phone: "+972500000009", givenName: "אביגיל", familyName: null },
    );
    const second = await test.services.calendar.addCustomer(
      shop.owner.actor,
      shop.business.id,
      { phone: "+972500000009", givenName: "אביגיל", familyName: null },
    );

    expect(second.user.id).toBe(first.user.id);
    expect(
      test.store.memberships.filter(
        (membership) =>
          membership.userId === first.user.id &&
          membership.businessId === shop.business.id,
      ),
    ).toHaveLength(1);
  });

  it("refuses somebody who does not work there", async () => {
    const shop = await anEstablishedBusiness(test);
    const stranger = await signIn(test, "+972500000003", "זר");

    await expect(
      test.services.calendar.addCustomer(stranger.actor, shop.business.id, {
        phone: "+972500000009",
        givenName: "אביגיל",
        familyName: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a worker write down who their own appointment is for", async () => {
    const shop = await anEstablishedBusiness(test);
    await test.services.business.inviteUser(shop.owner.actor, shop.business.id, {
      phone: "+972500000007",
      givenName: "שימי",
      role: "WORKER",
      resourceIds: [shop.resource.id],
    });
    const worker = await signIn(test, "+972500000007", "שימי");

    // Staff, not management: a WORKER filling their own diary has to be able
    // to say who the appointment is for.
    const customer = await test.services.calendar.addCustomer(
      worker.actor,
      shop.business.id,
      { phone: "+972500000009", givenName: "אביגיל", familyName: null },
    );
    expect(customer.membership?.role).toBe("CUSTOMER");
  });
});
