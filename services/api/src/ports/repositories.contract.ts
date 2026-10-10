import { describe, expect, it } from "vitest";
import {
  addDays,
  asId,
  dayOfWeek,
  displayName,
  formatInstant,
  localTime,
  isActive,
  microShekels,
  money,
  parseInstant,
  parseLocalDate,
  timeZone,
  type BusinessCategory,
  type Instant,
  type LocalDate,
  type PhotoSlot,
  type UserId,
} from "@tor-now/domain";
import type { Repositories } from "./repositories.ts";

/**
 * One suite, two implementations.
 *
 * The repository seam is only real if both sides of it behave the same, so the
 * behaviour is written once here and run against the in-memory adapter always,
 * and against Postgres whenever a database is available. A difference between
 * them shows up as a failing test rather than as a bug that only appears in
 * production — which is exactly how the two RLS faults in this system were
 * found the hard way.
 */
export type RepositoryFactory = () => Promise<{
  repositories: Repositories;
  /** Undo everything this run wrote, so the next case starts clean. */
  cleanUp: () => Promise<void>;
  /**
   * Establish who Postgres RLS sees as the caller for the rest of this case
   * (ADR 0007). The in-memory adapter has no RLS to fool, so it may no-op.
   */
  actAs?: (userId: UserId) => Promise<void>;
}>;

const AT = (iso: string): Instant => parseInstant(iso);

export const describeRepositoryContract = (
  implementation: string,
  open: RepositoryFactory,
): void => {
  describe(`repository contract (${implementation})`, () => {
    const withRepositories = async (
      body: (
        repositories: Repositories,
        actAs: (userId: UserId) => Promise<void>,
      ) => Promise<void>,
    ): Promise<void> => {
      const { repositories, cleanUp, actAs } = await open();
      try {
        await body(repositories, actAs ?? (async () => {}));
      } finally {
        await cleanUp();
      }
    };

    /** A business with one calendar and one service, the minimum to book. */
    const aBookableBusiness = async (repositories: Repositories, suffix: string) => {
      const owner = await repositories.users.create({
        phone: `+9725000${suffix}`,
        givenName: "בעלים",
          familyName: null,
        birthDate: null,
      });
      const business = await repositories.businesses.create({
        name: `עסק ${suffix}`,
        phone: `+9725000${suffix}`,
        timeZone: "Asia/Jerusalem",
        description: null,
        address: null,
        // Registration requires a location, and search skips a Business without one.
        latitude: 32.0853,
        longitude: 34.7818,
        categories: [],
      });
      await repositories.memberships.create(owner.id, business.id, "OWNER");
      const resource = await repositories.resources.create({
        businessId: business.id,
        name: "יומן",
      });
      const service = await repositories.services.create({
        businessId: business.id,
        name: "שירות",
        durationMinutes: 30,
        price: money(8000),
        bufferMinutes: 10,
      });
      return { owner, business, resource, service };
    };

    const anAppointmentAt = (
      context: Awaited<ReturnType<typeof aBookableBusiness>>,
      start: string,
      end: string,
      occupiedUntil: string,
    ) => ({
      businessId: context.business.id,
      resourceId: context.resource.id,
      serviceId: context.service.id,
      customerId: context.owner.id,
      startAt: AT(start),
      endAt: AT(end),
      occupiedUntil: AT(occupiedUntil),
      status: "CONFIRMED" as const,
      serviceName: "שירות",
      resourceName: "יומן",
      price: money(8000),
      durationMinutes: 30,
      bufferMinutes: 10,
      customerNote: null,
    });

    // --- Users ---------------------------------------------------------

    it("finds a user by phone, and keeps the phone after a soft delete", async () => {
      await withRepositories(async (repositories) => {
        const created = await repositories.users.create({
          phone: "+972500001111",
          givenName: "דנה",
          familyName: null,
          birthDate: null,
        });

        expect(await repositories.users.findByPhone("+972500001111")).toMatchObject({
          id: created.id,
        });

        await repositories.users.softDelete(created.id);

        // ADR 0008: hidden from findById, still holding its phone.
        expect(await repositories.users.findById(created.id)).toBeNull();
        expect(await repositories.users.findByPhone("+972500001111")).not.toBeNull();
      });
    });

    it("finds many users by id at once, and hides the deleted among them", async () => {
      await withRepositories(async (repositories) => {
        const her = await repositories.users.create({
          phone: "+972500001121",
          givenName: "דנה",
          familyName: null,
          birthDate: null,
        });
        const him = await repositories.users.create({
          phone: "+972500001122",
          givenName: "יוסי",
          familyName: null,
          birthDate: null,
        });
        const closed = await repositories.users.create({
          phone: "+972500001123",
          givenName: "סגור",
          familyName: null,
          birthDate: null,
        });
        await repositories.users.softDelete(closed.id);

        // An id repeated, an id nobody answers for, and a closed account: the
        // callers pass whatever the appointments gave them, so all three have
        // to behave — and the result is indexed by id, never by position.
        const found = await repositories.users.findByIds([
          her.id,
          him.id,
          her.id,
          closed.id,
          asId("00000000-0000-4000-8000-999999999999"),
        ]);

        expect([...found].map((user) => user.id).sort()).toEqual(
          [her.id, him.id].sort(),
        );
      });
    });

    it("asks nothing of the database for an empty list of ids", async () => {
      await withRepositories(async (repositories) => {
        expect(await repositories.users.findByIds([])).toEqual([]);
      });
    });

    it("restores a soft-deleted user", async () => {
      await withRepositories(async (repositories) => {
        const created = await repositories.users.create({
          phone: "+972500001112",
          givenName: "דנה",
          familyName: null,
          birthDate: null,
        });
        await repositories.users.softDelete(created.id);
        await repositories.users.restore(created.id);
        expect(await repositories.users.findById(created.id)).not.toBeNull();
      });
    });

    it("erases everything identifying and keeps the row", async () => {
      await withRepositories(async (repositories) => {
        const created = await repositories.users.create({
          phone: "+972500001114",
          givenName: "דנה כהן",
          familyName: null,
          birthDate: parseLocalDate("1990-01-01"),
        });

        const erased = await repositories.users.anonymise(created.id);

        expect(displayName(erased)).not.toBe("דנה כהן");
        expect(erased.phone).not.toBe("+972500001114");
        expect(erased.birthDate).toBeNull();
        expect(erased.anonymisedAt).not.toBeNull();
        // The number is released, so it can register again.
        expect(await repositories.users.findByPhone("+972500001114")).toBeNull();
      });
    });

    it("erases only once, however many times it is asked", async () => {
      await withRepositories(async (repositories) => {
        const created = await repositories.users.create({
          phone: "+972500001115",
          givenName: "דנה",
          familyName: null,
          birthDate: null,
        });
        const first = await repositories.users.anonymise(created.id);
        const second = await repositories.users.anonymise(created.id);
        expect(second.phone).toBe(first.phone);
        expect(second.anonymisedAt).toEqual(first.anonymisedAt);
      });
    });

    it("updates only the fields it is given", async () => {
      await withRepositories(async (repositories) => {
        const created = await repositories.users.create({
          phone: "+972500001113",
          givenName: "לפני",
          familyName: null,
          birthDate: parseLocalDate("1990-01-01"),
        });
        const updated = await repositories.users.update(created.id, {
          givenName: "אחרי",
          familyName: "כהן",
        });
        expect(displayName(updated)).toBe("אחרי כהן");
        expect(updated.birthDate).toBe("1990-01-01");
      });
    });

    it("records which terms a user agreed to, and when", async () => {
      await withRepositories(async (repositories) => {
        const created = await repositories.users.create({
          phone: "+972500001116",
          givenName: "דנה",
          familyName: null,
          birthDate: null,
        });
        expect(created.termsVersion).toBeNull();
        expect(created.termsAcceptedAt).toBeNull();

        const accepted = await repositories.users.acceptTerms(created.id, "2026-09-25");
        expect(accepted.termsVersion).toBe("2026-09-25");
        expect(accepted.termsAcceptedAt).not.toBeNull();
        expect((await repositories.users.findById(created.id))?.termsVersion).toBe("2026-09-25");
      });
    });

    // --- Memberships ---------------------------------------------------

    it("does not demote an owner who books at their own business", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02001");
        const membership = await repositories.memberships.ensureCustomer(
          context.owner.id,
          context.business.id,
        );
        expect(membership.role).toBe("OWNER");
      });
    });

    it("creates one customer membership however many times booking asks", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02002");
        const customer = await repositories.users.create({
          phone: "+972500002222",
          givenName: "דנה",
          familyName: null,
          birthDate: null,
        });

        const first = await repositories.memberships.ensureCustomer(
          customer.id,
          context.business.id,
        );
        const second = await repositories.memberships.ensureCustomer(
          customer.id,
          context.business.id,
        );
        expect(second.id).toBe(first.id);
        expect(
          await repositories.memberships.listForBusiness(context.business.id, "CUSTOMER"),
        ).toHaveLength(1);
      });
    });

    it("blocks a customer, and re-booking does not clear the block", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02003");
        const customer = await repositories.users.create({
          phone: "+972500002223",
          givenName: "רוני",
          familyName: null,
          birthDate: null,
        });
        await repositories.memberships.ensureCustomer(customer.id, context.business.id);

        const blocked = await repositories.memberships.setBlocked(
          customer.id,
          context.business.id,
          AT("2026-09-01T09:00:00Z"),
        );
        expect(blocked.blockedAt).not.toBeNull();

        const again = await repositories.memberships.ensureCustomer(
          customer.id,
          context.business.id,
        );
        expect(again.blockedAt).not.toBeNull();

        const cleared = await repositories.memberships.setBlocked(
          customer.id,
          context.business.id,
          null,
        );
        expect(cleared.blockedAt).toBeNull();
      });
    });

    it("promotes and removes a team member, and lists every role at once", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02004");
        const worker = await repositories.users.create({
          phone: "+972500002224",
          givenName: "יעל",
          familyName: null,
          birthDate: null,
        });
        const membership = await repositories.memberships.create(
          worker.id,
          context.business.id,
          "WORKER",
        );

        expect(await repositories.memberships.findById(membership.id)).toMatchObject({
          role: "WORKER",
        });

        const promoted = await repositories.memberships.setRole(membership.id, "MANAGER");
        expect(promoted.role).toBe("MANAGER");

        // listForBusiness takes one role; this one takes the whole team, which is
        // what a users list has to show.
        expect(
          await repositories.memberships.listAllForBusiness(context.business.id),
        ).toHaveLength(2);

        await repositories.memberships.delete(membership.id);
        expect(await repositories.memberships.findById(membership.id)).toBeNull();
      });
    });

    it("adds a customer by phone, and never rewrites a role already held", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "02009");
        await actAs(context.owner.id);

        // A number nobody holds: the User is created, the relationship with it.
        const added = await repositories.memberships.addCustomer(context.business.id, {
          phone: "+972500002229",
          givenName: "אביגיל",
          familyName: "נוי",
        });
        expect(added.user.phone).toBe("+972500002229");
        expect(added.membership).toMatchObject({
          userId: added.user.id,
          role: "CUSTOMER",
          invitedGivenName: "אביגיל",
        });

        // Again, with the same number: the same person and the same row.
        const again = await repositories.memberships.addCustomer(context.business.id, {
          phone: "+972500002229",
          givenName: "אביגיל",
          familyName: "נוי",
        });
        expect(again.user.id).toBe(added.user.id);
        expect(again.membership.id).toBe(added.membership.id);

        // And the reason this is not `invite`: booking a colleague a haircut
        // must not take away their calendar. The invitation path rewrites the
        // role on purpose; this one must not, and only a real database can
        // show which of the two the SQL actually does.
        const colleague = await repositories.memberships.invite(context.business.id, {
          phone: "+972500002230",
          givenName: "שימי",
          familyName: null,
          role: "WORKER",
          invitedGivenName: "שימי",
          invitedFamilyName: null,
        });
        const asCustomer = await repositories.memberships.addCustomer(
          context.business.id,
          { phone: "+972500002230", givenName: "שימי", familyName: null },
        );
        expect(asCustomer.membership.id).toBe(colleague.membership.id);
        expect(asCustomer.membership.role).toBe("WORKER");
      });
    });

    it("invites a not-yet-registered phone, then re-invites to update the role", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "02008");
        await actAs(context.owner.id);

        const { user, membership } = await repositories.memberships.invite(
          context.business.id,
          {
            phone: "+972500002228",
            givenName: "נועה",
            familyName: null,
            role: "WORKER",
            invitedGivenName: "נועה",
            invitedFamilyName: "כהן",
          },
        );
        expect(user.phone).toBe("+972500002228");
        expect(membership).toMatchObject({
          userId: user.id,
          role: "WORKER",
          invitedGivenName: "נועה",
          invitedFamilyName: "כהן",
        });

        const reinvited = await repositories.memberships.invite(context.business.id, {
          phone: "+972500002228",
          givenName: "נועה",
          familyName: null,
          role: "MANAGER",
          invitedGivenName: "נועה",
          invitedFamilyName: "לוי",
        });
        expect(reinvited.user.id).toBe(user.id);
        expect(reinvited.membership.id).toBe(membership.id);
        expect(reinvited.membership.role).toBe("MANAGER");
        expect(reinvited.membership.invitedFamilyName).toBe("לוי");
      });
    });

    // --- Membership resources ------------------------------------------

    it("assigns a resource to a worker, and lists it from either side", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02005");
        const worker = await repositories.users.create({
          phone: "+972500002225",
          givenName: "אורי",
          familyName: null,
          birthDate: null,
        });
        const membership = await repositories.memberships.create(
          worker.id,
          context.business.id,
          "WORKER",
        );

        const assignment = await repositories.membershipResources.create({
          membershipId: membership.id,
          businessId: context.business.id,
          resourceId: context.resource.id,
        });

        expect(
          await repositories.membershipResources.listForMembership(membership.id),
        ).toHaveLength(1);
        expect(
          await repositories.membershipResources.listForResource(context.resource.id),
        ).toMatchObject([{ id: assignment.id }]);

        await repositories.membershipResources.delete(assignment.id);
        expect(
          await repositories.membershipResources.listForMembership(membership.id),
        ).toEqual([]);
      });
    });

    it("refuses the same resource twice for one membership", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02006");
        const worker = await repositories.users.create({
          phone: "+972500002226",
          givenName: "נועה",
          familyName: null,
          birthDate: null,
        });
        const membership = await repositories.memberships.create(
          worker.id,
          context.business.id,
          "WORKER",
        );
        const assignment = {
          membershipId: membership.id,
          businessId: context.business.id,
          resourceId: context.resource.id,
        };
        await repositories.membershipResources.create(assignment);

        await expect(
          repositories.membershipResources.create(assignment),
        ).rejects.toThrow();
      });
    });

    it("takes the assignments with the membership", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "02007");
        const worker = await repositories.users.create({
          phone: "+972500002227",
          givenName: "גיל",
          familyName: null,
          birthDate: null,
        });
        const membership = await repositories.memberships.create(
          worker.id,
          context.business.id,
          "WORKER",
        );
        await repositories.membershipResources.create({
          membershipId: membership.id,
          businessId: context.business.id,
          resourceId: context.resource.id,
        });

        await repositories.memberships.delete(membership.id);

        // The composite foreign key cascades: no assignment outlives the
        // membership it granted, so nobody keeps reach after being removed.
        expect(
          await repositories.membershipResources.listForResource(context.resource.id),
        ).toEqual([]);
      });
    });

    // --- Appointments: ADR 0003 ----------------------------------------

    it("refuses an appointment overlapping a confirmed one", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "03001");
        await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );

        await expect(
          repositories.appointments.create(
            anAppointmentAt(
              context,
              "2026-09-01T09:35:00.000Z",
              "2026-09-01T10:05:00.000Z",
              "2026-09-01T10:15:00.000Z",
            ),
          ),
        ).rejects.toMatchObject({ code: "SLOT_TAKEN" });
      });
    });

    it("accepts an appointment starting exactly where the buffer ends", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "03002");
        await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );

        // Half-open: adjacent, not conflicting.
        const second = await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:40:00.000Z",
            "2026-09-01T10:10:00.000Z",
            "2026-09-01T10:20:00.000Z",
          ),
        );
        expect(isActive(second)).toBe(true);
      });
    });

    it("frees the time again when an appointment is cancelled", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "03003");
        const first = await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );

        await repositories.appointments.update(first.id, {
          status: "CANCELLED",
          cancelledAt: AT("2026-08-31T09:00:00.000Z"),
          cancelledBy: "CUSTOMER",
        });

        const rebooked = await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );
        expect(rebooked.status).toBe("CONFIRMED");
      });
    });

    it("writes and clears the customer's note without touching the time", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "03005");
        const booked = await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );

        const noted = await repositories.appointments.update(booked.id, {
          customerNote: "מגיעים עם ילד",
        });
        expect(noted.customerNote).toBe("מגיעים עם ילד");
        expect(noted.startAt).toEqual(booked.startAt);

        // An update that says nothing about the note leaves it alone.
        const moved = await repositories.appointments.update(booked.id, {
          startAt: AT("2026-09-01T10:00:00.000Z"),
          endAt: AT("2026-09-01T10:30:00.000Z"),
          occupiedUntil: AT("2026-09-01T10:40:00.000Z"),
        });
        expect(moved.customerNote).toBe("מגיעים עם ילד");

        expect(
          (await repositories.appointments.update(booked.id, { customerNote: null }))
            .customerNote,
        ).toBeNull();
      });
    });

    it("reports occupied spans without any customer detail", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "03004");
        await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );

        const spans = await repositories.appointments.occupiedBetween(
          context.resource.id,
          AT("2026-09-01T00:00:00.000Z"),
          AT("2026-09-02T00:00:00.000Z"),
        );

        expect(spans).toHaveLength(1);
        expect(Object.keys(spans[0]!).sort()).toEqual([
          "appointmentId",
          "occupiedUntil",
          "startAt",
        ]);
      });
    });

    it("leaves a cancelled appointment out of the occupied spans", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "03005");
        const appointment = await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );
        await repositories.appointments.update(appointment.id, {
          status: "CANCELLED",
          cancelledAt: AT("2026-08-31T09:00:00.000Z"),
          cancelledBy: "CUSTOMER",
        });

        expect(
          await repositories.appointments.occupiedBetween(
            context.resource.id,
            AT("2026-09-01T00:00:00.000Z"),
            AT("2026-09-02T00:00:00.000Z"),
          ),
        ).toEqual([]);
      });
    });

    // --- Schedule layers: ADR 0002 -------------------------------------

    it("finds an override by its own id, ranges included", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04801");
        const date = parseLocalDate("2026-09-08");
        const written = await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date,
          note: "יום קצר",
          ranges: [{ startMinutes: 600, endMinutes: 720 }],
        });

        const found = await repositories.dateOverrides.findById(written.id);

        // Whose calendar it stands on is the point of the lookup.
        expect(found?.resourceId).toBe(context.resource.id);
        expect(found?.date).toBe(date);
        expect(found?.ranges).toHaveLength(1);
        expect(
          await repositories.dateOverrides.findById(
            asId("00000000-0000-4000-8000-999999999999"),
          ),
        ).toBeNull();
      });
    });


    /**
     * The batched writes, which a closure uses in place of one round trip per
     * calendar per date. Each asks the same thing: does writing them together
     * leave exactly what writing them one at a time left?
     */
    it("writes many overrides at once, replacing what each day held", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04701");
        const second = await repositories.resources.create({
          businessId: context.business.id,
          name: "יומן ב",
        });
        const ids = [context.resource.id, second.id];
        const first = parseLocalDate("2026-09-01");
        const last = parseLocalDate("2026-09-03");
        const dates = [first, parseLocalDate("2026-09-02"), last];

        // A short day on one of them first, so the batch has something to replace.
        await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date: first,
          note: "לפני",
          ranges: [{ startMinutes: 600, endMinutes: 660 }],
        });

        const written = await repositories.dateOverrides.putMany(
          ids.flatMap((resourceId) =>
            dates.map((date) => ({
              resourceId,
              businessId: context.business.id,
              date,
              note: "חופשה",
              ranges: [],
            })),
          ),
        );

        expect(written).toHaveLength(6);
        // Read back rather than trusted: a closed day is an override with no
        // ranges, and the one that had hours has lost them.
        const held = await repositories.dateOverrides.listForResources(ids, first, last);
        expect(held).toHaveLength(6);
        expect(held.every((one) => one.ranges.length === 0)).toBe(true);
        expect(held.every((one) => one.note === "חופשה")).toBe(true);

        // And again, which is what a closure written twice does: still six.
        await repositories.dateOverrides.putMany(
          ids.flatMap((resourceId) =>
            dates.map((date) => ({
              resourceId,
              businessId: context.business.id,
              date,
              note: "שוב",
              ranges: [{ startMinutes: 540, endMinutes: 720 }],
            })),
          ),
        );
        const again = await repositories.dateOverrides.listForResources(ids, first, last);
        expect(again).toHaveLength(6);
        expect(again.every((one) => one.ranges.length === 1)).toBe(true);
        expect(await repositories.dateOverrides.putMany([])).toEqual([]);
      });
    });

    it("removes a span of overrides and hands back what stood there", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04702");
        const inside = parseLocalDate("2026-09-10");
        const outside = parseLocalDate("2026-09-20");
        for (const date of [inside, outside]) {
          await repositories.dateOverrides.put({
            resourceId: context.resource.id,
            businessId: context.business.id,
            date,
            note: "סגור",
            ranges: [{ startMinutes: 600, endMinutes: 720 }],
          });
        }

        const removed = await repositories.dateOverrides.deleteBetween(
          [context.resource.id],
          inside,
          inside,
        );

        // What was there, hours included — the caller has a date to mark and a
        // trail to write, and after the delete there is nothing left to read.
        expect(removed).toHaveLength(1);
        expect(removed[0]?.date).toBe(inside);
        expect(removed[0]?.ranges).toHaveLength(1);
        // The day outside the span is untouched.
        expect(
          await repositories.dateOverrides.listForResource(context.resource.id, inside, outside),
        ).toHaveLength(1);
        expect(await repositories.dateOverrides.deleteBetween([], inside, inside)).toEqual([]);
      });
    });

    it("rewords a span of overrides and leaves their hours alone", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04703");
        const date = parseLocalDate("2026-09-14");
        await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date,
          note: "חופשה",
          ranges: [{ startMinutes: 600, endMinutes: 720 }],
        });

        const renamed = await repositories.dateOverrides.renameBetween(
          [context.resource.id],
          date,
          date,
          "שיפוצים",
        );

        expect(renamed).toHaveLength(1);
        expect(renamed[0]?.note).toBe("שיפוצים");
        // The words changed and nothing else did.
        expect(renamed[0]?.ranges).toHaveLength(1);
        const held = await repositories.dateOverrides.findByDate(context.resource.id, date);
        expect(held?.note).toBe("שיפוצים");
        expect(held?.ranges).toHaveLength(1);
        expect(await repositories.dateOverrides.renameBetween([], date, date, "x")).toEqual([]);
      });
    });

    it("marks many days for a recheck in one go, and twice is once", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04704");
        const dates = [parseLocalDate("2026-09-01"), parseLocalDate("2026-09-02")];

        await repositories.waitingRechecks.markMany(
          dates.map((onDate) => ({ resourceId: context.resource.id, onDate })),
        );
        // The same mark again is still one mark: the work is "look at this day".
        await repositories.waitingRechecks.markMany([
          { resourceId: context.resource.id, onDate: dates[0] as never },
        ]);
        await repositories.waitingRechecks.markMany([]);

        const marks = await repositories.waitingRechecks.oldest(10);
        const mine = marks.filter((mark) => mark.resourceId === context.resource.id);
        expect(mine).toHaveLength(2);
        expect([...mine].map((mark) => mark.onDate).sort()).toEqual([...dates].sort());
      });
    });


    it("reads the calendars of several businesses at once, inactive ones included", async () => {
      await withRepositories(async (repositories) => {
        const here = await aBookableBusiness(repositories, "04601");
        const there = await aBookableBusiness(repositories, "04602");
        // A withdrawn calendar still comes back, exactly as the single-business
        // read returns it: search decides what "active" means, not the store.
        const withdrawn = await repositories.resources.create({
          businessId: here.business.id,
          name: "יומן שהוסר",
        });
        await repositories.resources.update(withdrawn.id, { active: false });

        const both = await repositories.resources.listForBusinesses([
          here.business.id,
          there.business.id,
        ]);

        for (const business of [here.business, there.business]) {
          expect(both.filter((one) => one.businessId === business.id)).toEqual(
            await repositories.resources.listForBusiness(business.id),
          );
        }
        expect(both.some((one) => one.id === withdrawn.id && !one.active)).toBe(true);
        expect(await repositories.resources.listForBusinesses([])).toEqual([]);
      });
    });


    /**
     * The plural reads, which a screen drawing every calendar side by side uses
     * in place of one round trip per calendar.
     *
     * What each case is really asking is whether the batched statement answers
     * exactly what the single-calendar one answers, calendar by calendar —
     * because that equivalence is the whole claim being made by using it.
     */
    it("reads the schedule of several calendars at once, as the single-calendar reads would", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04501");
        const second = await repositories.resources.create({
          businessId: context.business.id,
          name: "יומן ב",
        });
        // A third, left empty on purpose: a calendar with nothing on it must
        // still be answerable, and is exactly what a naive grouping loses.
        const empty = await repositories.resources.create({
          businessId: context.business.id,
          name: "יומן ג",
        });
        const ids = [context.resource.id, second.id, empty.id];
        const date = parseLocalDate("2026-09-01");
        const from = parseInstant("2026-09-01T00:00:00Z");
        const to = parseInstant("2026-09-02T00:00:00Z");

        // One of each layer, on two of the three calendars.
        for (const resourceId of [context.resource.id, second.id]) {
          await repositories.workingHours.create({
            resourceId,
            businessId: context.business.id,
            dayOfWeek: 2,
            startMinutes: 540,
            endMinutes: 1020,
          });
          await repositories.dateOverrides.put({
            resourceId,
            businessId: context.business.id,
            date,
            note: "יום מיוחד",
            ranges: [{ startMinutes: 600, endMinutes: 720 }],
          });
          await repositories.blocks.create({
            resourceId,
            businessId: context.business.id,
            startAt: parseInstant("2026-09-01T09:00:00Z"),
            endAt: parseInstant("2026-09-01T10:00:00Z"),
            reason: "הפסקה",
            groupId: crypto.randomUUID(),
          });
        }
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-01T11:00:00Z", "2026-09-01T11:30:00Z", "2026-09-01T11:40:00Z"),
        );
        await repositories.appointments.create({
          ...anAppointmentAt(context, "2026-09-01T13:00:00Z", "2026-09-01T13:30:00Z", "2026-09-01T13:40:00Z"),
          resourceId: second.id,
        });

        const [hours, overrides, blocks, appointments] = await Promise.all([
          repositories.workingHours.listForResources(ids),
          repositories.dateOverrides.listForResources(ids, date, date),
          repositories.blocks.listForResourcesBetween(ids, from, to),
          repositories.appointments.listForResourcesBetween(ids, from, to),
        ]);

        // Grouped by calendar, the batch is the single-calendar answer.
        for (const resourceId of ids) {
          expect(hours.filter((one) => one.resourceId === resourceId)).toEqual(
            await repositories.workingHours.listForResource(resourceId),
          );
          expect(overrides.filter((one) => one.resourceId === resourceId)).toEqual(
            await repositories.dateOverrides.listForResource(resourceId, date, date),
          );
          expect(blocks.filter((one) => one.resourceId === resourceId)).toEqual(
            await repositories.blocks.listForResourceBetween(resourceId, from, to),
          );
          expect(appointments.filter((one) => one.resourceId === resourceId)).toEqual(
            await repositories.appointments.listForResourceBetween(resourceId, from, to),
          );
        }

        // And the empty calendar contributes nothing rather than failing.
        expect(hours.filter((one) => one.resourceId === empty.id)).toEqual([]);
        expect(appointments.filter((one) => one.resourceId === empty.id)).toEqual([]);
        // The ranges came back hydrated, not as a bare override with no hours.
        expect(overrides.every((one) => one.ranges.length === 1)).toBe(true);
      });
    });

    it("asks nothing of the database for an empty list of calendars", async () => {
      await withRepositories(async (repositories) => {
        const date = parseLocalDate("2026-09-01");
        const from = parseInstant("2026-09-01T00:00:00Z");
        const to = parseInstant("2026-09-02T00:00:00Z");
        expect(await repositories.workingHours.listForResources([])).toEqual([]);
        expect(await repositories.dateOverrides.listForResources([], date, date)).toEqual([]);
        expect(await repositories.blocks.listForResourcesBetween([], from, to)).toEqual([]);
        expect(await repositories.appointments.listForResourcesBetween([], from, to)).toEqual([]);
        expect(
          await repositories.appointments.countsByLocalDayForResources(
            [], from, to, timeZone("Asia/Jerusalem"),
          ),
        ).toEqual([]);
      });
    });


    it("replaces a date override wholesale, ranges included", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04001");
        const date = parseLocalDate("2026-09-01");

        await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date,
          note: null,
          ranges: [
            { startMinutes: 600, endMinutes: 720 },
            { startMinutes: 900, endMinutes: 1020 },
          ],
        });

        const replaced = await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date,
          note: "יום קצר",
          ranges: [{ startMinutes: 600, endMinutes: 660 }],
        });

        expect(replaced.ranges).toHaveLength(1);
        const found = await repositories.dateOverrides.findByDate(context.resource.id, date);
        expect(found?.ranges).toHaveLength(1);
      });
    });

    it("stores a day off as an override with no ranges at all", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04002");
        const date = parseLocalDate("2026-09-01");

        await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date,
          note: null,
          ranges: [],
        });

        const found = await repositories.dateOverrides.findByDate(context.resource.id, date);
        expect(found).not.toBeNull();
        expect(found?.ranges).toEqual([]);
      });
    });

    it("reports blocked spans without the reason the owner wrote", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04003");
        await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: AT("2026-09-01T09:00:00.000Z"),
          endAt: AT("2026-09-01T10:00:00.000Z"),
          reason: "פגישה אישית",
          groupId: "11111111-1111-4111-8111-111111111111",
        });

        // A blockage made as one decision comes back as one, and goes away as
        // one — scoped by business, since the group id travels in a URL.
        await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: AT("2026-09-02T09:00:00.000Z"),
          endAt: AT("2026-09-02T10:00:00.000Z"),
          reason: "חופשה",
          groupId: "22222222-2222-4222-8222-222222222222",
        });
        await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: AT("2026-09-03T09:00:00.000Z"),
          endAt: AT("2026-09-03T10:00:00.000Z"),
          reason: "חופשה",
          groupId: "22222222-2222-4222-8222-222222222222",
        });
        expect(
          await repositories.blocks.listGroup(context.business.id, "22222222-2222-4222-8222-222222222222"),
        ).toHaveLength(2);

        // What it is called belongs to the decision, not to each of its days:
        // renaming one and leaving the other describes a decision nobody made.
        expect(
          await repositories.blocks.renameGroup(
            context.business.id,
            "22222222-2222-4222-8222-222222222222",
            "מילואים",
          ),
        ).toBe(2);
        expect(
          (
            await repositories.blocks.listGroup(
              context.business.id,
              "22222222-2222-4222-8222-222222222222",
            )
          ).map((block) => block.reason),
        ).toEqual(["מילואים", "מילואים"]);
        // And it reaches no further than the business it was asked about.
        expect(
          (
            await repositories.blocks.listGroup(
              context.business.id,
              "11111111-1111-4111-8111-111111111111",
            )
          ).map((block) => block.reason),
        ).toEqual(["פגישה אישית"]);

        expect(
          await repositories.blocks.deleteGroup(context.business.id, "22222222-2222-4222-8222-222222222222"),
        ).toBe(2);
        expect(
          await repositories.blocks.listGroup(context.business.id, "22222222-2222-4222-8222-222222222222"),
        ).toEqual([]);

        const spans = await repositories.blocks.blockedBetween(
          context.resource.id,
          AT("2026-09-01T00:00:00.000Z"),
          AT("2026-09-02T00:00:00.000Z"),
        );
        expect(spans).toHaveLength(1);
        expect(JSON.stringify(spans)).not.toContain("פגישה");
      });
    });

    it("keeps working hours ordered by weekday and start", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "04004");
        await repositories.workingHours.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          dayOfWeek: 2,
          startMinutes: 960,
          endMinutes: 1200,
        });
        await repositories.workingHours.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          dayOfWeek: 2,
          startMinutes: 540,
          endMinutes: 780,
        });

        const hours = await repositories.workingHours.listForResource(context.resource.id);
        expect(hours.map((range) => range.start)).toEqual([540, 960]);
      });
    });

    // --- Services -------------------------------------------------------

    it("withdraws a booked service instead of removing it", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "05001");
        await repositories.appointments.create(
          anAppointmentAt(
            context,
            "2026-09-01T09:00:00.000Z",
            "2026-09-01T09:30:00.000Z",
            "2026-09-01T09:40:00.000Z",
          ),
        );

        await repositories.services.delete(context.service.id);

        const kept = await repositories.services.findById(context.service.id);
        expect(kept).not.toBeNull();
        expect(kept?.active).toBe(false);
      });
    });

    it("removes a service nobody has booked", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "05002");
        await repositories.services.delete(context.service.id);
        expect(await repositories.services.findById(context.service.id)).toBeNull();
      });
    });

    // --- Reading back what was written -----------------------------------
    //
    // These say little about behaviour and a great deal about SQL. Every one of
    // them is a statement that had never been executed against Postgres, which
    // is how `dueForReminder` went on selecting a renamed column for four
    // migrations. The integration suite now fails if a repository method is
    // never reached from here, so this section is what keeps that honest.

    it("reads a business, a resource and a service back by id and by owner", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7101");

        expect(await repositories.resources.findById(context.resource.id)).toMatchObject({
          id: context.resource.id,
          name: "יומן",
        });
        expect(
          await repositories.resources.listForBusiness(context.business.id),
        ).toHaveLength(1);
        expect(
          await repositories.services.listForBusiness(context.business.id, true),
        ).toHaveLength(1);
        expect(
          await repositories.businesses.list({ limit: 10, offset: 0 }, "עסק"),
        ).not.toHaveLength(0);
      });
    });

    it("updates a business, a resource and a service, and returns the new row", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7102");

        expect(
          await repositories.businesses.update(context.business.id, {
            name: "שם חדש",
            address: "הרצל 1",
            latitude: 32.0853,
            longitude: 34.7818,
            categories: ["barbershop", "nail_salon"],
          }),
        ).toMatchObject({
          name: "שם חדש",
          address: "הרצל 1",
          latitude: 32.0853,
          longitude: 34.7818,
          categories: ["barbershop", "nail_salon"],
        });
        // ADR 0024: the order is the meaning — the first is the main one — so
        // swapping two comes back swapped, and an update leaving them out keeps them.
        expect(
          await repositories.businesses.update(context.business.id, {
            categories: ["nail_salon", "barbershop"],
          }),
        ).toMatchObject({ categories: ["nail_salon", "barbershop"] });
        expect(
          await repositories.businesses.update(context.business.id, { name: "שם שלישי" }),
        ).toMatchObject({ categories: ["nail_salon", "barbershop"] });
        expect(await repositories.businesses.findById(context.business.id)).toMatchObject({
          categories: ["nail_salon", "barbershop"],
        });

        expect(
          await repositories.resources.update(context.resource.id, { name: "כיסא שני" }),
        ).toMatchObject({ name: "כיסא שני" });

        expect(
          await repositories.services.update(context.service.id, {
            name: "צבע",
            price: money(25000),
          }),
        ).toMatchObject({ name: "צבע", price: 25000 });

        // "A business keeps at least one calendar" is the service's rule, not
        // the table's, so a second one can be made and removed here.
        const spare = await repositories.resources.create({
          businessId: context.business.id,
          name: "כיסא שני",
        });
        await repositories.resources.delete(spare.id);
        expect(
          await repositories.resources.listForBusiness(context.business.id),
        ).toHaveLength(1);
      });
    });

    it("finds a membership from either end", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7103");

        expect(
          await repositories.memberships.find(context.owner.id, context.business.id),
        ).toMatchObject({ role: "OWNER" });
        expect(await repositories.memberships.listForUser(context.owner.id)).toHaveLength(1);
      });
    });

    it("reads an appointment back by id, by customer and by span", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7104");
        const booked = await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z", "2026-09-15T09:40:00Z"),
        );
        const span = [
          parseInstant("2026-09-15T00:00:00Z"),
          parseInstant("2026-09-16T00:00:00Z"),
        ] as const;

        expect(await repositories.appointments.findById(booked.id)).toMatchObject({
          id: booked.id,
        });
        expect(
          await repositories.appointments.listForCustomer(context.owner.id, {
            limit: 10,
            offset: 0,
          }),
        ).toHaveLength(1);
        // The customer's own list also places the business, so the screen can
        // say where it is and how far. Given an address here on purpose: the
        // fixture leaves it null, and null proves nothing about a join.
        await repositories.businesses.update(context.business.id, {
          address: "הרצל 1",
          categories: ["nail_salon", "barbershop"],
        });
        expect(
          await repositories.appointments.listForCustomerWithBusiness(context.owner.id, {
            limit: 10,
            offset: 0,
          }),
        ).toMatchObject([
          {
            businessName: context.business.name,
            // The main Category, which is the first, places the business on the list.
            businessCategory: "nail_salon",
            resourceName: context.resource.name,
            businessAddress: "הרצל 1",
            businessLatitude: context.business.latitude,
            businessLongitude: context.business.longitude,
          },
        ]);
        expect(
          await repositories.appointments.listForCustomerAtBusiness(
            context.owner.id,
            context.business.id,
          ),
        ).toHaveLength(1);
        // The appointment itself, since the screen has to name it back to the
        // person: which service, with whom, and at what time.
        expect(
          await repositories.appointments.confirmedForServiceBetween(
            context.owner.id,
            booked.serviceId,
            span[0],
            span[1],
          ),
        ).toMatchObject({ id: booked.id, resourceName: context.resource.name });
        // The day before holds nothing, so the span is what decides the answer.
        expect(
          await repositories.appointments.confirmedForServiceBetween(
            context.owner.id,
            booked.serviceId,
            parseInstant("2026-09-14T00:00:00Z"),
            span[0],
          ),
        ).toBeNull();
        // Overlap is what the question is about, so the boundaries are the
        // interesting part: a span that lands inside it clashes, and a span
        // that begins exactly where it ends does not.
        expect(
          await repositories.appointments.overlappingForCustomer(
            context.owner.id,
            parseInstant("2026-09-15T09:15:00Z"),
            parseInstant("2026-09-15T09:45:00Z"),
          ),
        ).toMatchObject({
          appointment: { id: booked.id },
          businessName: context.business.name,
          resourceName: context.resource.name,
        });
        expect(
          await repositories.appointments.overlappingForCustomer(
            context.owner.id,
            parseInstant("2026-09-15T09:30:00Z"),
            parseInstant("2026-09-15T10:00:00Z"),
          ),
        ).toBeNull();
        expect(
          await repositories.appointments.overlappingForCustomer(
            context.owner.id,
            parseInstant("2026-09-15T08:00:00Z"),
            parseInstant("2026-09-15T09:00:00Z"),
          ),
        ).toBeNull();
        expect(
          await repositories.appointments.listForBusinessBetween(
            context.business.id,
            span[0],
            span[1],
          ),
        ).toHaveLength(1);
        expect(
          await repositories.appointments.listForResourceBetween(
            context.resource.id,
            span[0],
            span[1],
          ),
        ).toHaveLength(1);
      });
    });

    it("withdraws a calendar that has been booked, and removes one that has not", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7106");
        const spare = await repositories.resources.create({
          businessId: context.business.id,
          name: "כיסא פנוי",
        });

        // Nobody has booked the spare one, so there is no history to keep.
        await repositories.resources.delete(spare.id);
        expect(await repositories.resources.findById(spare.id)).toBeNull();

        // The other one has an appointment against it. Removing the row would
        // take the appointment with it — the foreign key cascades — so what a
        // business asks for as "delete" has to mean "stop offering it".
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-17T09:00:00Z", "2026-09-17T09:30:00Z", "2026-09-17T09:40:00Z"),
        );
        await repositories.resources.delete(context.resource.id);

        expect(await repositories.resources.findById(context.resource.id)).toMatchObject({
          id: context.resource.id,
          active: false,
        });
        expect(
          await repositories.appointments.listForCustomerAtBusiness(
            context.owner.id,
            context.business.id,
          ),
        ).toHaveLength(1);
      });
    });

    it("lists what is still to come on a calendar, and nothing behind it", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7107");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-18T09:00:00Z", "2026-09-18T09:30:00Z", "2026-09-18T09:40:00Z"),
        );
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-19T09:00:00Z", "2026-09-19T09:30:00Z", "2026-09-19T09:40:00Z"),
        );

        const from = parseInstant("2026-09-19T00:00:00Z");
        const upcoming = await repositories.appointments.upcomingForResource(
          context.resource.id,
          from,
        );

        expect(upcoming).toHaveLength(1);
        expect(upcoming[0]?.startAt).toBe(parseInstant("2026-09-19T09:00:00Z"));
      });
    });

    it("counts what is still to come on every calendar at once", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7108");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-20T09:00:00Z", "2026-09-20T09:30:00Z", "2026-09-20T09:40:00Z"),
        );
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-20T10:00:00Z", "2026-09-20T10:30:00Z", "2026-09-20T10:40:00Z"),
        );

        const counts = await repositories.appointments.upcomingCountsByResource(
          context.business.id,
          parseInstant("2026-09-20T00:00:00Z"),
        );

        expect(counts.get(context.resource.id)).toBe(2);
        // A calendar with nothing booked is absent rather than zero; the caller
        // reads a missing key as none.
        expect(counts.size).toBe(1);
      });
    });

    it("names everyone who has booked, whatever their role is here", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7105");
        // The booker is this business's own owner, which is the case the
        // customer list used to miss.
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-16T09:00:00Z", "2026-09-16T09:30:00Z", "2026-09-16T09:40:00Z"),
        );

        expect(
          await repositories.appointments.customerIdsFor(context.business.id),
        ).toEqual([context.owner.id]);
      });
    });

    it("finds a customer's first attended visit, and only inside the span", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7109");
        // Cancelled, so it was never a visit; the one after it is the first.
        const calledOff = await repositories.appointments.create(
          anAppointmentAt(context, "2026-08-10T09:00:00Z", "2026-08-10T09:30:00Z", "2026-08-10T09:40:00Z"),
        );
        await repositories.appointments.update(calledOff.id, {
          status: "CANCELLED",
          cancelledAt: AT("2026-08-01T09:00:00Z"),
          cancelledBy: "CUSTOMER",
        });
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-16T09:00:00Z", "2026-09-16T09:30:00Z", "2026-09-16T09:40:00Z"),
        );
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-10-16T09:00:00Z", "2026-10-16T09:30:00Z", "2026-10-16T09:40:00Z"),
        );
        const now = AT("2026-11-01T00:00:00Z");

        expect(
          await repositories.appointments.firstVisitsBetween(
            context.business.id, AT("2026-09-01T00:00:00Z"), AT("2026-10-01T00:00:00Z"), now,
          ),
        ).toEqual([
          { customerId: context.owner.id, resourceId: context.resource.id, firstAt: AT("2026-09-16T09:00:00Z") },
        ]);
        // October holds a visit, but not the first.
        expect(
          await repositories.appointments.firstVisitsBetween(
            context.business.id, AT("2026-10-01T00:00:00Z"), AT("2026-11-01T00:00:00Z"), now,
          ),
        ).toEqual([]);
      });
    });

    it("lists and deletes a block, an override and a working-hours range", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7105");

        const block = await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: parseInstant("2026-09-16T06:00:00Z"),
          endAt: parseInstant("2026-09-16T08:00:00Z"),
          reason: "ספק",
          groupId: "11111111-1111-4111-8111-111111111111",
        });
        expect(
          await repositories.blocks.listForResourceBetween(
            context.resource.id,
            parseInstant("2026-09-16T00:00:00Z"),
            parseInstant("2026-09-17T00:00:00Z"),
          ),
        ).toHaveLength(1);
        await repositories.blocks.delete(block.id);
        expect(
          await repositories.blocks.listForResourceBetween(
            context.resource.id,
            parseInstant("2026-09-16T00:00:00Z"),
            parseInstant("2026-09-17T00:00:00Z"),
          ),
        ).toEqual([]);

        const override = await repositories.dateOverrides.put({
          resourceId: context.resource.id,
          businessId: context.business.id,
          date: parseLocalDate("2026-09-17"),
          note: null,
          ranges: [{ startMinutes: 600, endMinutes: 720 }],
        });
        expect(
          await repositories.dateOverrides.listForResource(
            context.resource.id,
            parseLocalDate("2026-09-17"),
            parseLocalDate("2026-09-17"),
          ),
        ).toHaveLength(1);
        // The caller only has the id, so what comes back is what lets it mark
        // the date for the waiting list. ADR 0018.
        expect(await repositories.dateOverrides.delete(override.id)).toEqual({
          resourceId: context.resource.id,
          date: parseLocalDate("2026-09-17"),
        });
        expect(await repositories.dateOverrides.delete(override.id)).toBeNull();
        expect(
          await repositories.dateOverrides.listForResource(
            context.resource.id,
            parseLocalDate("2026-09-17"),
            parseLocalDate("2026-09-17"),
          ),
        ).toEqual([]);

        const hours = await repositories.workingHours.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          dayOfWeek: dayOfWeek(3),
          startMinutes: localTime(540),
          endMinutes: localTime(1020),
        });
        // The domain calls them start and end; only the column and the write
        // are minutes, which is exactly the kind of seam worth reading back.
        expect(
          await repositories.workingHours.update(hours.id, {
            startMinutes: localTime(540),
            endMinutes: localTime(960),
          }),
        ).toMatchObject({ start: 540, end: 960 });
        await repositories.workingHours.delete(hours.id);
        expect(
          await repositories.workingHours.listForResource(context.resource.id),
        ).toEqual([]);

        // A whole week in one statement, in place of whatever was there.
        await repositories.workingHours.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          dayOfWeek: dayOfWeek(1),
          startMinutes: localTime(600),
          endMinutes: localTime(700),
        });
        const week = await repositories.workingHours.replaceForResource(
          context.resource.id,
          context.business.id,
          [
            { dayOfWeek: 0, startMinutes: localTime(540), endMinutes: localTime(780) },
            { dayOfWeek: 0, startMinutes: localTime(960), endMinutes: localTime(1140) },
            { dayOfWeek: 5, startMinutes: localTime(540), endMinutes: localTime(780) },
          ],
        );
        expect(week).toHaveLength(3);
        expect(
          (await repositories.workingHours.listForResource(context.resource.id)).map(
            (entry) => `${entry.dayOfWeek}:${entry.start}-${entry.end}`,
          ),
        ).toEqual(["0:540-780", "0:960-1140", "5:540-780"]);

        // And an empty week is a calendar that keeps no hours at all, not a
        // no-op that leaves the old ones standing.
        expect(
          await repositories.workingHours.replaceForResource(
            context.resource.id,
            context.business.id,
            [],
          ),
        ).toEqual([]);
        expect(
          await repositories.workingHours.listForResource(context.resource.id),
        ).toEqual([]);
      });
    });

    it("records a payment and reads it back", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7106");
        const subscription = await repositories.subscriptions.findByBusiness(
          context.business.id,
        );
        expect(subscription).not.toBeNull();

        await repositories.payments.create({
          subscriptionId: subscription!.id,
          businessId: context.business.id,
          amount: money(12000),
          paidOn: parseLocalDate("2026-09-01"),
          recordedBy: context.owner.id,
          note: "העברה בנקאית",
        });

        const paid = await repositories.payments.listForBusiness(context.business.id);
        expect(paid).toHaveLength(1);
        expect(paid[0]).toMatchObject({ amount: 12000, note: "העברה בנקאית" });
      });
    });

    it("reads a photo back by id", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7107");
        const photo = await repositories.businessPhotos.create({
          businessId: context.business.id,
          slot: 0,
          storagePath: `${context.business.id}/cover.jpg`,
          contentType: "image/jpeg",
          byteSize: 10,
        });
        expect(await repositories.businessPhotos.findById(photo.id)).toMatchObject({
          id: photo.id,
          slot: 0,
        });
      });
    });

    it("lists users and the administrator allowlist, and grants the flag", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7108");

        expect(
          await repositories.users.list({ limit: 10, offset: 0 }, null),
        ).not.toHaveLength(0);
        expect(
          await repositories.users.setAdministrator(context.owner.id, true),
        ).toMatchObject({ isAdministrator: true });

        await repositories.administratorAllowlist.add(
          context.owner.phone,
          "contract",
          context.owner.id,
        );
        expect(await repositories.administratorAllowlist.list()).not.toHaveLength(0);
      });
    });

    // --- Finding one appointment -----------------------------------------

    it("finds an appointment by either half of the customer's name", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "6101");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-11-20T09:00:00Z", "2026-11-20T09:30:00Z", "2026-11-20T09:40:00Z"),
        );
        const from = parseInstant("2026-09-01T00:00:00Z");

        // Far enough ahead that no day view would have shown it.
        const byGiven = await repositories.appointments.searchUpcoming(
          context.business.id,
          "בעלים",
          from,
          10,
        );
        expect(byGiven).toHaveLength(1);
        expect(byGiven[0]?.customerName).toBe(displayName(context.owner));
        expect(byGiven[0]?.customerPhone).toBe(context.owner.phone);

        expect(
          await repositories.appointments.searchUpcoming(
            context.business.id,
            context.owner.phone.slice(-6),
            from,
            10,
          ),
        ).toHaveLength(1);
      });
    });

    it("finds an appointment by the whole name, and by the number the way it is written locally", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "6108");
        const her = await repositories.users.create({
          phone: "+972550006108",
          givenName: "דנה",
          familyName: "כהן",
          birthDate: null,
        });
        await repositories.appointments.create({
          ...anAppointmentAt(context, "2026-11-20T09:00:00Z", "2026-11-20T09:30:00Z", "2026-11-20T09:40:00Z"),
          customerId: her.id,
        });
        const from = parseInstant("2026-09-01T00:00:00Z");
        const found = (query: string) =>
          repositories.appointments.searchUpcoming(context.business.id, query, from, 10);

        for (const query of ["דנה כהן", "0550006108", "055-000-6108", "+972 55 000 6108"]) {
          expect(await found(query), query).toHaveLength(1);
        }
        // Typed characters, not wildcards: a percent sign matches no name here.
        expect(await found("%")).toHaveLength(0);
        expect(await found("_")).toHaveLength(0);
      });
    });

    it("finds a person for an administrator the same ways", async () => {
      await withRepositories(async (repositories) => {
        const her = await repositories.users.create({
          phone: "+972550006109",
          givenName: "רוני",
          familyName: "אבידן",
          birthDate: null,
        });
        const ids = async (query: string) =>
          (await repositories.users.list({ limit: 50, offset: 0 }, query)).map((user) => user.id);

        for (const query of ["רוני אבידן", "אבידן", "0550006109", "055-000-6109"]) {
          expect(await ids(query), query).toContain(her.id);
        }
        expect(await ids("%")).not.toContain(her.id);
      });
    });

    it("offers nothing that has already been and gone", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "6102");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-01T09:00:00Z", "2026-09-01T09:30:00Z", "2026-09-01T09:40:00Z"),
        );
        // An owner searching mid-call is changing something, and there is
        // nothing to change about a day that has gone.
        expect(
          await repositories.appointments.searchUpcoming(
            context.business.id,
            "בעלים",
            parseInstant("2026-09-02T00:00:00Z"),
            10,
          ),
        ).toEqual([]);
      });
    });

    it("offers nothing cancelled, and nothing from another business", async () => {
      await withRepositories(async (repositories) => {
        const mine = await aBookableBusiness(repositories, "6103");
        const theirs = await aBookableBusiness(repositories, "6104");
        const from = parseInstant("2026-09-01T00:00:00Z");

        const booked = await repositories.appointments.create(
          anAppointmentAt(mine, "2026-11-21T09:00:00Z", "2026-11-21T09:30:00Z", "2026-11-21T09:40:00Z"),
        );
        await repositories.appointments.create(
          anAppointmentAt(theirs, "2026-11-21T11:00:00Z", "2026-11-21T11:30:00Z", "2026-11-21T11:40:00Z"),
        );

        expect(
          await repositories.appointments.searchUpcoming(mine.business.id, "בעלים", from, 10),
        ).toHaveLength(1);

        await repositories.appointments.update(booked.id, {
          status: "CANCELLED",
          cancelledAt: parseInstant("2026-11-01T09:00:00Z"),
          cancelledBy: "CUSTOMER",
        });
        expect(
          await repositories.appointments.searchUpcoming(mine.business.id, "בעלים", from, 10),
        ).toEqual([]);
      });
    });

    it("returns the soonest first, which is the one being asked about", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "6105");
        for (const day of ["2026-12-20", "2026-11-20", "2027-01-20"]) {
          await repositories.appointments.create(
            anAppointmentAt(context, `${day}T09:00:00Z`, `${day}T09:30:00Z`, `${day}T09:40:00Z`),
          );
        }
        const found = await repositories.appointments.searchUpcoming(
          context.business.id,
          "בעלים",
          parseInstant("2026-09-01T00:00:00Z"),
          10,
        );
        expect(found.map((match) => formatInstant(match.appointment.startAt))).toEqual([
          "2026-11-20T09:00:00.000Z",
          "2026-12-20T09:00:00.000Z",
          "2027-01-20T09:00:00.000Z",
        ]);
      });
    });

    // --- Reminders: ADR 0005 ---------------------------------------------

    it("finds an appointment due a reminder, naming everyone it has to name", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "5101");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-10T09:00:00Z", "2026-09-10T09:30:00Z", "2026-09-10T09:40:00Z"),
        );

        const due = await repositories.appointments.dueForReminder(
          parseInstant("2026-09-10T08:00:00Z"),
          parseInstant("2026-09-10T10:00:00Z"),
          10,
        );

        expect(due).toHaveLength(1);
        // Every field the message is built from. The customer's name is two
        // columns joined, which is the part that broke silently when they were
        // split and nothing here read it back.
        expect(due[0]?.customerName).toBe(displayName(context.owner));
        expect(due[0]?.customerPhone).toBe(context.owner.phone);
        expect(due[0]?.businessName).toBe(context.business.name);
        expect(due[0]?.businessPhone).toBe(context.business.phone);
        expect(due[0]?.businessTimeZone).toBe(context.business.timeZone);
      });
    });

    it("stops offering one once its reminder has been enqueued", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "5102");
        const booked = await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-11T09:00:00Z", "2026-09-11T09:30:00Z", "2026-09-11T09:40:00Z"),
        );
        const window = [
          parseInstant("2026-09-11T08:00:00Z"),
          parseInstant("2026-09-11T10:00:00Z"),
        ] as const;

        await repositories.appointments.markReminderEnqueued([booked.id]);

        // ADR 0005: the stamp is what makes the job safe to run as often as
        // anyone likes.
        expect(
          await repositories.appointments.dueForReminder(window[0], window[1], 10),
        ).toEqual([]);
      });
    });

    it("does not remind about an appointment outside the window", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "5103");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-12T15:00:00Z", "2026-09-12T15:30:00Z", "2026-09-12T15:40:00Z"),
        );
        expect(
          await repositories.appointments.dueForReminder(
            parseInstant("2026-09-12T08:00:00Z"),
            parseInstant("2026-09-12T10:00:00Z"),
            10,
          ),
        ).toEqual([]);
      });
    });

    // --- Month counts ---------------------------------------------------

    it("counts a day by the business's own zone, not the server's", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4101");
        // 21:30 UTC is already the next day in Jerusalem, which is the whole
        // point of asking the database to group by the zone.
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-01T21:30:00Z", "2026-09-01T22:00:00Z", "2026-09-01T22:10:00Z"),
        );

        const counts = await repositories.appointments.countsByLocalDay(
          context.resource.id,
          parseInstant("2026-09-01T00:00:00Z"),
          parseInstant("2026-09-30T21:00:00Z"),
          timeZone("Asia/Jerusalem"),
        );
        expect(counts).toEqual([{ date: parseLocalDate("2026-09-02"), count: 1 }]);
      });
    });

    it("counts a month for several calendars at once, each day naming its calendar", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4104");
        const second = await repositories.resources.create({
          businessId: context.business.id,
          name: "יומן ב",
        });
        const zone = timeZone("Asia/Jerusalem");
        const from = parseInstant("2026-09-01T00:00:00Z");
        const to = parseInstant("2026-09-30T21:00:00Z");

        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-10T09:00:00Z", "2026-09-10T09:30:00Z", "2026-09-10T09:40:00Z"),
        );
        await repositories.appointments.create({
          ...anAppointmentAt(context, "2026-09-10T11:00:00Z", "2026-09-10T11:30:00Z", "2026-09-10T11:40:00Z"),
          resourceId: second.id,
        });
        // Cancelled, and so not a busy day for anybody — the same rule the
        // single-calendar count obeys.
        const calledOff = await repositories.appointments.create({
          ...anAppointmentAt(context, "2026-09-11T09:00:00Z", "2026-09-11T09:30:00Z", "2026-09-11T09:40:00Z"),
          resourceId: second.id,
        });
        await repositories.appointments.update(calledOff.id, {
          status: "CANCELLED",
          cancelledAt: parseInstant("2026-09-10T09:00:00Z"),
          cancelledBy: "CUSTOMER",
        });

        const counts = await repositories.appointments.countsByLocalDayForResources(
          [context.resource.id, second.id], from, to, zone,
        );

        expect([...counts].sort((left, right) => left.resourceId.localeCompare(right.resourceId)))
          .toEqual(
            [
              { resourceId: context.resource.id, date: parseLocalDate("2026-09-10"), count: 1 },
              { resourceId: second.id, date: parseLocalDate("2026-09-10"), count: 1 },
            ].sort((left, right) => left.resourceId.localeCompare(right.resourceId)),
          );

        // Calendar by calendar, it agrees with the single-calendar count.
        for (const resourceId of [context.resource.id, second.id]) {
          expect(
            counts
              .filter((one) => one.resourceId === resourceId)
              .map(({ date, count }) => ({ date, count })),
          ).toEqual(await repositories.appointments.countsByLocalDay(resourceId, from, to, zone));
        }
      });
    });

    it("does not count a cancelled appointment as a busy day", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4102");
        const booked = await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-08T09:00:00Z", "2026-09-08T09:30:00Z", "2026-09-08T09:40:00Z"),
        );
        const zone = timeZone("Asia/Jerusalem");
        const span = [
          parseInstant("2026-09-01T00:00:00Z"),
          parseInstant("2026-09-30T21:00:00Z"),
        ] as const;

        expect(
          await repositories.appointments.countsByLocalDay(context.resource.id, span[0], span[1], zone),
        ).toHaveLength(1);

        await repositories.appointments.update(booked.id, {
          status: "CANCELLED",
          cancelledAt: parseInstant("2026-09-07T09:00:00Z"),
          cancelledBy: "CUSTOMER",
        });

        expect(
          await repositories.appointments.countsByLocalDay(context.resource.id, span[0], span[1], zone),
        ).toEqual([]);
      });
    });

    it("counts several on one day as one day with several", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4103");
        for (const hour of ["09", "11", "13"]) {
          await repositories.appointments.create(
            anAppointmentAt(
              context,
              `2026-09-15T${hour}:00:00Z`,
              `2026-09-15T${hour}:30:00Z`,
              `2026-09-15T${hour}:40:00Z`,
            ),
          );
        }
        const counts = await repositories.appointments.countsByLocalDay(
          context.resource.id,
          parseInstant("2026-09-01T00:00:00Z"),
          parseInstant("2026-09-30T21:00:00Z"),
          timeZone("Asia/Jerusalem"),
        );
        expect(counts).toEqual([{ date: parseLocalDate("2026-09-15"), count: 3 }]);
      });
    });

    // --- Platform statistics ---------------------------------------------

    it("adds up a week's appointments by how they ended", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4201");
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z", "2026-09-15T09:40:00Z"),
        );
        const cancelled = await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-16T09:00:00Z", "2026-09-16T09:30:00Z", "2026-09-16T09:40:00Z"),
        );
        await repositories.appointments.update(cancelled.id, {
          status: "CANCELLED",
          cancelledAt: parseInstant("2026-09-15T09:00:00Z"),
          cancelledBy: "CUSTOMER",
        });
        const noShow = await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-17T09:00:00Z", "2026-09-17T09:30:00Z", "2026-09-17T09:40:00Z"),
        );
        await repositories.appointments.update(noShow.id, { status: "NO_SHOW" });
        // A different week entirely, so the test also proves the buckets do
        // not bleed into one another.
        await repositories.appointments.create(
          anAppointmentAt(context, "2026-09-21T09:00:00Z", "2026-09-21T09:30:00Z", "2026-09-21T09:40:00Z"),
        );

        const weeks = await repositories.appointments.platformWeeklyActivity(
          parseInstant("2026-09-14T00:00:00Z"),
          parseInstant("2026-09-28T00:00:00Z"),
        );

        expect(weeks).toEqual([
          {
            weekStart: parseLocalDate("2026-09-14"),
            confirmed: 1,
            cancelled: 1,
            noShow: 1,
            completed: 0,
          },
          {
            weekStart: parseLocalDate("2026-09-21"),
            confirmed: 1,
            cancelled: 0,
            noShow: 0,
            completed: 0,
          },
        ]);
      });
    });

    it("ranks businesses by appointments booked, cancellations excluded", async () => {
      await withRepositories(async (repositories) => {
        const busy = await aBookableBusiness(repositories, "4301");
        const quiet = await aBookableBusiness(repositories, "4302");

        await repositories.appointments.create(
          anAppointmentAt(busy, "2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z", "2026-09-15T09:40:00Z"),
        );
        await repositories.appointments.create(
          anAppointmentAt(busy, "2026-09-16T09:00:00Z", "2026-09-16T09:30:00Z", "2026-09-16T09:40:00Z"),
        );
        const cancelled = await repositories.appointments.create(
          anAppointmentAt(busy, "2026-09-17T09:00:00Z", "2026-09-17T09:30:00Z", "2026-09-17T09:40:00Z"),
        );
        await repositories.appointments.update(cancelled.id, {
          status: "CANCELLED",
          cancelledAt: parseInstant("2026-09-16T09:00:00Z"),
          cancelledBy: "CUSTOMER",
        });
        await repositories.appointments.create(
          anAppointmentAt(quiet, "2026-09-15T10:00:00Z", "2026-09-15T10:30:00Z", "2026-09-15T10:40:00Z"),
        );

        const span = [parseInstant("2026-09-14T00:00:00Z"), parseInstant("2026-09-21T00:00:00Z")] as const;

        expect(await repositories.appointments.topBusinessesByVolume(span[0], span[1], 10)).toEqual([
          { businessId: busy.business.id, businessName: busy.business.name, count: 2 },
          { businessId: quiet.business.id, businessName: quiet.business.name, count: 1 },
        ]);

        expect(await repositories.appointments.topBusinessesByVolume(span[0], span[1], 1)).toEqual([
          { businessId: busy.business.id, businessName: busy.business.name, count: 2 },
        ]);
      });
    });

    it("counts a business in the month it registered", async () => {
      await withRepositories(async (repositories) => {
        const from = parseInstant(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        const to = parseInstant(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
        const before = await repositories.businesses.monthlySignups(from, to);
        const totalBefore = before.reduce((sum, month) => sum + month.count, 0);

        await aBookableBusiness(repositories, "4401");

        const after = await repositories.businesses.monthlySignups(from, to);
        const totalAfter = after.reduce((sum, month) => sum + month.count, 0);
        expect(totalAfter).toBe(totalBefore + 1);

        expect(
          await repositories.businesses.monthlySignups(
            parseInstant("2020-01-01T00:00:00Z"),
            parseInstant("2020-02-01T00:00:00Z"),
          ),
        ).toEqual([]);
      });
    });

    it("counts a user in the month they registered", async () => {
      await withRepositories(async (repositories) => {
        const from = parseInstant(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        const to = parseInstant(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
        const before = await repositories.users.monthlySignups(from, to);
        const totalBefore = before.reduce((sum, month) => sum + month.count, 0);

        await repositories.users.create({
          phone: "+972500004402",
          givenName: "מאיה",
          familyName: null,
          birthDate: null,
        });

        const after = await repositories.users.monthlySignups(from, to);
        const totalAfter = after.reduce((sum, month) => sum + month.count, 0);
        expect(totalAfter).toBe(totalBefore + 1);
      });
    });

    it("counts a new user in the platform total", async () => {
      await withRepositories(async (repositories) => {
        const before = await repositories.users.count();

        await repositories.users.create({
          phone: "+972500004403",
          givenName: "נועה",
          familyName: null,
          birthDate: null,
        });

        expect(await repositories.users.count()).toBe(before + 1);
      });
    });

    it("counts blocks the same way, so a day off shows on the grid", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4104");
        await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: parseInstant("2026-09-20T06:00:00Z"),
          endAt: parseInstant("2026-09-20T14:00:00Z"),
          reason: "חופשה",
          groupId: "11111111-1111-4111-8111-111111111111",
        });
        expect(
          await repositories.blocks.countsByLocalDay(
            context.resource.id,
            parseInstant("2026-09-01T00:00:00Z"),
            parseInstant("2026-09-30T21:00:00Z"),
            timeZone("Asia/Jerusalem"),
          ),
        ).toEqual([{ date: parseLocalDate("2026-09-20"), count: 1 }]);
      });
    });

    // --- Photos ---------------------------------------------------------

    it("holds one photo per slot and refuses a second in the same one", async () => {
      await withRepositories(async (repositories) => {
        const { business } = await aBookableBusiness(repositories, "3101");
        const add = (slot: PhotoSlot, path: string) =>
          repositories.businessPhotos.create({
            businessId: business.id,
            slot,
            storagePath: path,
            contentType: "image/jpeg",
            byteSize: 1234,
          });

        const cover = await add(0, `${business.id}/cover.jpg`);
        expect(cover.slot).toBe(0);

        // The limit is the slot, not a count kept somewhere.
        await expect(add(0, `${business.id}/again.jpg`)).rejects.toThrow();
      });
    });

    it("returns the cover first and the rest in slot order", async () => {
      await withRepositories(async (repositories) => {
        const { business } = await aBookableBusiness(repositories, "3102");
        // Added out of order on purpose: the order is a property of the read.
        for (const slot of [2, 0, 3] as PhotoSlot[]) {
          await repositories.businessPhotos.create({
            businessId: business.id,
            slot,
            storagePath: `${business.id}/${slot}.jpg`,
            contentType: "image/jpeg",
            byteSize: 10,
          });
        }
        const held = await repositories.businessPhotos.listForBusiness(business.id);
        expect(held.map((photo) => photo.slot)).toEqual([0, 2, 3]);
      });
    });

    it("frees the slot again when a photo is deleted", async () => {
      await withRepositories(async (repositories) => {
        const { business } = await aBookableBusiness(repositories, "3103");
        const first = await repositories.businessPhotos.create({
          businessId: business.id,
          slot: 1,
          storagePath: `${business.id}/first.jpg`,
          contentType: "image/png",
          byteSize: 99,
        });
        await repositories.businessPhotos.delete(first.id);
        const replacement = await repositories.businessPhotos.create({
          businessId: business.id,
          slot: 1,
          storagePath: `${business.id}/second.jpg`,
          contentType: "image/png",
          byteSize: 99,
        });
        expect(replacement.slot).toBe(1);
        expect(
          await repositories.businessPhotos.listForBusiness(business.id),
        ).toHaveLength(1);
      });
    });

    it("keeps each business's photos to itself", async () => {
      await withRepositories(async (repositories) => {
        const mine = await aBookableBusiness(repositories, "3104");
        const theirs = await aBookableBusiness(repositories, "3105");
        await repositories.businessPhotos.create({
          businessId: mine.business.id,
          slot: 0,
          storagePath: `${mine.business.id}/cover.jpg`,
          contentType: "image/webp",
          byteSize: 7,
        });
        expect(
          await repositories.businessPhotos.listForBusiness(theirs.business.id),
        ).toEqual([]);
      });
    });

    // --- Reviews --------------------------------------------------------

    it("keeps one review per customer per business, edited in place", async () => {
      await withRepositories(async (repositories) => {
        const mine = await aBookableBusiness(repositories, "3201");
        const theirs = await aBookableBusiness(repositories, "3202");
        const customer = await repositories.users.create({
          phone: "+972500003203",
          givenName: "דנה",
          familyName: "לוי",
          birthDate: null,
        });
        const review = { businessId: mine.business.id, customerId: customer.id };

        expect(await repositories.reviews.findFor(review.businessId, review.customerId)).toBeNull();
        const first = await repositories.reviews.put({
          ...review,
          stars: 3,
          comment: "בסדר",
          anonymous: false,
        });
        const edited = await repositories.reviews.put({
          ...review,
          stars: 5,
          comment: "מעולה",
          anonymous: false,
        });

        expect(edited).toMatchObject({ id: first.id, stars: 5, comment: "מעולה", authorName: "דנה" });
        expect(await repositories.reviews.listForBusiness(mine.business.id)).toMatchObject([
          { id: first.id, stars: 5, customerId: customer.id },
        ]);
        expect(await repositories.reviews.listForBusiness(theirs.business.id)).toEqual([]);

        // Anonymous hides who wrote it from the public list, not from the row.
        await repositories.reviews.put({ ...review, stars: 2, comment: "", anonymous: true });
        expect(await repositories.reviews.listForBusiness(mine.business.id)).toMatchObject([
          { id: first.id, anonymous: true, authorName: null, customerId: null },
        ]);
        expect(
          await repositories.reviews.findFor(review.businessId, review.customerId),
        ).toMatchObject({ id: first.id, anonymous: true, customerId: customer.id });
      });
    });

    // --- Discovery: ADR 0011 --------------------------------------------

    it("finds an active business by part of its name and skips inactive ones", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "06001");
        expect(
          (await repositories.businesses.search({ text: context.business.name, category: null, inferred: [], near: null })).map(
            (result) => result.business.id,
          ),
        ).toContain(context.business.id);

        await repositories.businesses.setActive(context.business.id, false);
        expect(
          (await repositories.businesses.search({ text: context.business.name, category: null, inferred: [], near: null })).map(
            (result) => result.business.id,
          ),
        ).not.toContain(context.business.id);
      });
    });

    it("leaves a business with no location out of every search", async () => {
      await withRepositories(async (repositories) => {
        const nowhere = await aBookableBusiness(repositories, "06005");
        await repositories.businesses.update(nowhere.business.id, { latitude: null, longitude: null });
        const ids = async (text: string) =>
          (await repositories.businesses.search({ text, category: null, inferred: [], near: null })).map(
            (result) => result.business.id,
          );
        expect(await ids("")).not.toContain(nowhere.business.id);
        expect(await ids(nowhere.business.name)).not.toContain(nowhere.business.id);
      });
    });

    it("browses a category nearest first, and finds a business through an inferred one", async () => {
      await withRepositories(async (repositories) => {
        const near = await aBookableBusiness(repositories, "06002");
        const far = await aBookableBusiness(repositories, "06003");
        const nails = await aBookableBusiness(repositories, "06004");
        await repositories.businesses.update(near.business.id, {
          categories: ["barbershop"],
          latitude: 32.08,
          longitude: 34.78,
        });
        await repositories.businesses.update(far.business.id, {
          categories: ["barbershop"],
          latitude: 32.79,
          longitude: 34.99,
        });
        await repositories.businesses.update(nails.business.id, { categories: ["nail_salon"] });
        const ids = (results: readonly { business: { id: string } }[]) =>
          results.map((result) => result.business.id);

        const browse = ids(
          await repositories.businesses.search({
            text: "",
            category: "barbershop",
            inferred: [],
            near: { latitude: 32.07, longitude: 34.77 },
          }),
        );
        expect(browse).toContain(near.business.id);
        expect(browse).not.toContain(nails.business.id);
        expect(browse.indexOf(near.business.id)).toBeLessThan(browse.indexOf(far.business.id));

        // "ספר" is nowhere in "עסק 06002"; the Category is what finds it.
        const inferred = ids(
          await repositories.businesses.search({
            text: "ספר",
            category: null,
            inferred: ["barbershop"],
            near: null,
          }),
        );
        expect(inferred).toContain(near.business.id);
        expect(inferred).not.toContain(nails.business.id);

        const filtered = ids(
          await repositories.businesses.search({
            text: near.business.name,
            category: "nail_salon",
            inferred: [],
            near: null,
          }),
        );
        expect(filtered).not.toContain(near.business.id);
      });
    });

    it("finds a business under any of its categories, not only the main one", async () => {
      await withRepositories(async (repositories) => {
        const both = await aBookableBusiness(repositories, "06006");
        const other = await aBookableBusiness(repositories, "06007");
        await repositories.businesses.update(both.business.id, {
          categories: ["hair_salon", "nail_salon", "makeup_artist"],
        });
        await repositories.businesses.update(other.business.id, { categories: ["massage"] });
        const ids = async (search: Parameters<typeof repositories.businesses.search>[0]) =>
          (await repositories.businesses.search(search)).map((result) => result.business.id);
        const browse = (category: BusinessCategory) =>
          ids({ text: "", category, inferred: [], near: null });

        expect(await browse("hair_salon")).toContain(both.business.id);
        expect(await browse("nail_salon")).toContain(both.business.id);
        expect(await browse("makeup_artist")).toContain(both.business.id);
        expect(await browse("massage")).not.toContain(both.business.id);
        expect(await browse("massage")).toContain(other.business.id);

        // An inferred Category matching only the third still finds it.
        expect(
          await ids({ text: "מאפרת", category: null, inferred: ["makeup_artist"], near: null }),
        ).toContain(both.business.id);
        expect(
          await ids({ text: "מאפרת", category: null, inferred: ["makeup_artist"], near: null }),
        ).not.toContain(other.business.id);

        // A business with none chosen yet is found by name and by no Category.
        await repositories.businesses.update(other.business.id, { categories: [] });
        expect(await browse("massage")).not.toContain(other.business.id);
        expect(
          await ids({ text: other.business.name, category: null, inferred: [], near: null }),
        ).toContain(other.business.id);
      });
    });

    // --- Billing --------------------------------------------------------

    it("gives every new business a subscription on Solo, with neither Trial nor payment", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07001");
        const subscription = await repositories.subscriptions.findByBusiness(context.business.id);
        const version =
          subscription === null ? null : await repositories.planVersions.findById(subscription.planVersionId);
        expect(version?.plan).toBe("SOLO");
        expect(subscription?.trialEndsOn).toBeNull();
        expect(subscription?.paidThrough).toBeNull();
        expect(subscription?.scheduledMove).toBeNull();
      });
    });

    it("seeds the Catalogue: the current edition of each Plan, and the waiting-list Preview", async () => {
      await withRepositories(async (repositories) => {
        const current = await repositories.planVersions.listCurrent();
        const byPlan = Object.fromEntries(current.map((version) => [version.plan, version]));
        expect(byPlan["SOLO"]?.terms).toEqual({
          features: ["REMINDERS"],
          resourceAllowance: 1,
          price: 4900,
        });
        expect(byPlan["TEAM"]?.terms).toEqual({
          features: ["REMINDERS", "CUSTOMER_HISTORY", "TEAM_ROLES"],
          resourceAllowance: 5,
          price: 8900,
        });
        expect((await repositories.previews.list()).map((preview) => preview.feature)).toEqual([
          "WAITING_LIST",
        ]);
      });
    });

    it("starts a new Business's Plan and Trial, and claims its owner's one Trial", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "07003");
        const team = (await repositories.planVersions.listCurrent()).find(
          (version) => version.plan === "TEAM",
        );
        if (team === undefined) throw new Error("No current Team edition");
        expect(await repositories.users.trialTakenOn(context.owner.id)).toBeNull();

        await actAs(context.owner.id);
        const trialEndsOn = addDays(parseLocalDate(new Date().toISOString().slice(0, 10)), 29);
        const started = await repositories.subscriptions.start(context.business.id, {
          planVersionId: team.id,
          trialEndsOn,
        });

        expect(started.planVersionId).toBe(team.id);
        expect(started.trialEndsOn).toBe(trialEndsOn);
        expect(await repositories.users.trialTakenOn(context.owner.id)).not.toBeNull();

        // The owner's Trial is spent: a second one is refused, whatever the Business.
        await expect(
          repositories.subscriptions.start(context.business.id, {
            planVersionId: team.id,
            trialEndsOn,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      });
    });

    it("gives the Entitlement's inputs to anyone acting on the Business", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "07004");
        const stranger = await repositories.users.create({
          phone: "+972500007005",
          givenName: "לקוחה",
          familyName: null,
          birthDate: null,
        });
        await actAs(stranger.id);
        const basis = await repositories.subscriptions.entitlementBasis(context.business.id);
        expect(basis?.grants).toEqual([]);
        expect(basis?.planVersionId).toBeDefined();
      });
    });

    it("sets and clears a scheduled move as one", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07006");
        const [solo] = await repositories.planVersions.listCurrent();
        if (solo === undefined) throw new Error("No current edition");
        const effectiveOn = parseLocalDate("2026-11-01");

        const scheduled = await repositories.subscriptions.update(context.business.id, {
          scheduledMove: { planVersionId: solo.id, effectiveOn },
          paidThrough: parseLocalDate("2026-10-31"),
        });
        expect(scheduled.scheduledMove).toEqual({ planVersionId: solo.id, effectiveOn });

        const cleared = await repositories.subscriptions.update(context.business.id, {
          scheduledMove: null,
        });
        expect(cleared.scheduledMove).toBeNull();
        // A change that does not mention a column leaves it alone.
        expect(cleared.paidThrough).toBe("2026-10-31");
      });
    });

    it("lists every edition of every Plan, old ones included", async () => {
      await withRepositories(async (repositories) => {
        const all = await repositories.planVersions.listAll();
        const current = await repositories.planVersions.listCurrent();
        expect(all.length).toBeGreaterThanOrEqual(current.length);
        for (const version of current) expect(all.map((candidate) => candidate.id)).toContain(version.id);
      });
    });

    it("reads the directory: each Business with its Subscription, calendars on offer and first owner", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07008");
        const retired = await repositories.resources.create({ businessId: context.business.id, name: "ישן" });
        await repositories.resources.update(retired.id, { active: false });

        const entry = (await repositories.subscriptions.directory()).find(
          (candidate) => candidate.business.id === context.business.id,
        );

        expect(entry?.business.name).toBe(context.business.name);
        expect(entry?.subscription.businessId).toBe(context.business.id);
        expect(entry?.subscription.paidThrough).toBeNull();
        // The withdrawn calendar is not on offer.
        expect(entry?.resourcesOnOffer).toBe(1);
        expect(entry?.owner).toEqual({ name: "בעלים", phone: "+972500007008" });
      });
    });

    it("pauses calendars and puts them back, leaving everything else about them alone", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07010");
        const second = await repositories.resources.create({ businessId: context.business.id, name: "שני" });
        const at = AT("2031-03-10T10:00:00.000Z");

        expect(await repositories.resources.setPaused([], at)).toEqual([]);
        const paused = await repositories.resources.setPaused([second.id], at);
        expect(paused).toEqual([{ ...second, pausedAt: at }]);
        expect((await repositories.resources.findById(context.resource.id))?.pausedAt).toBeNull();

        // An owner's own update never lifts a pause.
        await repositories.resources.update(second.id, { name: "שני שני" });
        expect((await repositories.resources.findById(second.id))?.pausedAt).toBe(at);

        const back = await repositories.resources.setPaused([second.id], null);
        expect(back[0]?.pausedAt).toBeNull();
        expect(back[0]?.name).toBe("שני שני");
      });
    });

    it("marks calendars to pause on a day, and finds them when it comes", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07011");
        const second = await repositories.resources.create({ businessId: context.business.id, name: "שני" });
        const on = parseLocalDate("2031-03-10");

        await repositories.resources.setPauseOn([], on);
        await repositories.resources.setPauseOn([second.id], on);
        expect((await repositories.resources.findById(second.id))?.pauseOn).toBe(on);

        const ids = async (today: string) =>
          (await repositories.resources.listDueToPause(parseLocalDate(today))).map((resource) => resource.id);
        expect(await ids("2031-03-09")).not.toContain(second.id);
        expect(await ids("2031-03-10")).toContain(second.id);

        await repositories.resources.setPauseOn([second.id], null);
        expect((await repositories.resources.findById(second.id))?.pauseOn).toBeNull();
      });
    });

    it("lets an owner move their own Plan, and lists the moves that fall due", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "07012");
        const current = await repositories.planVersions.listCurrent();
        const team = current.find((version) => version.plan === "TEAM");
        const solo = current.find((version) => version.plan === "SOLO");
        if (team === undefined || solo === undefined) throw new Error("No current editions");
        const effectiveOn = parseLocalDate("2031-04-01");

        await actAs(context.owner.id);
        const moved = await repositories.subscriptions.setPlanAsOwner(context.business.id, {
          planVersionId: team.id,
          scheduledMove: { planVersionId: solo.id, effectiveOn },
        });
        expect(moved.planVersionId).toBe(team.id);
        expect(moved.scheduledMove).toEqual({ planVersionId: solo.id, effectiveOn });

        const due = async (today: string) =>
          (await repositories.subscriptions.listDueMoves(parseLocalDate(today))).map((s) => s.businessId);
        expect(await due("2031-03-31")).not.toContain(context.business.id);
        expect(await due("2031-04-01")).toContain(context.business.id);
      });
    });

    it("reads the default unit rates, dated and sourced", async () => {
      await withRepositories(async (repositories) => {
        const rates = await repositories.unitRates.list();
        expect(rates.map(({ unit, effectiveFrom, perUnit }) => ({ unit, effectiveFrom, perUnit }))).toEqual([
          { unit: "SMS_SEGMENT", effectiveFrom: "2026-09-01", perUnit: 952_750 },
          { unit: "WHATSAPP_AUTHENTICATION", effectiveFrom: "2026-09-01", perUnit: 19_610 },
          { unit: "WHATSAPP_UTILITY", effectiveFrom: "2026-09-01", perUnit: 19_610 },
        ]);
        for (const rate of rates) expect(rate.source).toMatch(/^Default/);
      });
    });

    it("publishes a Plan's next edition, carries additions onto one, and withdraws one out of current", async () => {
      await withRepositories(async (repositories) => {
        const soloV1 = (await repositories.planVersions.listCurrent()).find((version) => version.plan === "SOLO");
        if (soloV1 === undefined) throw new Error("No Solo edition");
        const firstMoveOn = parseLocalDate("2031-04-01");

        const v2 = await repositories.planVersions.publish({
          plan: "SOLO",
          number: soloV1.number + 1,
          terms: { ...soloV1.terms, price: money(5900) },
          firstMoveOn,
        });
        expect(v2).toMatchObject({ plan: "SOLO", number: soloV1.number + 1, withdrawnAt: null, firstMoveOn });
        expect(v2.terms.price).toBe(5900);
        expect((await repositories.planVersions.listCurrent()).find((version) => version.plan === "SOLO")?.id).toBe(v2.id);

        const improved = await repositories.planVersions.setTerms(soloV1.id, { ...soloV1.terms, resourceAllowance: 2 });
        expect(improved.terms.resourceAllowance).toBe(2);
        expect((await repositories.planVersions.findById(soloV1.id))?.terms.resourceAllowance).toBe(2);

        const at = AT("2031-03-10T10:00:00.000Z");
        await repositories.planVersions.withdraw(v2.id, at);
        expect((await repositories.planVersions.listCurrent()).find((version) => version.plan === "SOLO")?.id).toBe(soloV1.id);
        const editions = await repositories.planVersions.listEditions();
        expect(editions.find((edition) => edition.id === v2.id)?.withdrawnAt).toBe(at);
        // Nobody may join a withdrawn edition, whatever the path.
        const context = await aBookableBusiness(repositories, "07041");
        expect((await repositories.subscriptions.findByBusiness(context.business.id))?.planVersionId).toBe(soloV1.id);
      });
    });

    it("starts a Preview, moves its end, decides where it goes, and starts it afresh once ended", async () => {
      await withRepositories(async (repositories) => {
        const endsOn = parseLocalDate("2031-05-01");
        const started = await repositories.previews.start("CUSTOMER_HISTORY", endsOn);
        expect(started).toEqual({ feature: "CUSTOMER_HISTORY", endsOn, placement: null, decidedAt: null });
        expect(await repositories.previews.list()).toContainEqual({ feature: "CUSTOMER_HISTORY", endsOn });

        const later = parseLocalDate("2031-06-01");
        expect((await repositories.previews.setEnd("CUSTOMER_HISTORY", later)).endsOn).toBe(later);

        const at = AT("2031-03-10T10:00:00.000Z");
        const placed = await repositories.previews.place("CUSTOMER_HISTORY", { keepOn: ["TEAM"], endsOn: later }, at);
        expect(placed).toMatchObject({ placement: { keepOn: ["TEAM"] }, decidedAt: at });
        expect((await repositories.previews.listEntries()).find((entry) => entry.feature === "CUSTOMER_HISTORY")).toEqual(placed);

        // A fresh Preview of the same Feature is undecided again.
        const again = await repositories.previews.start("CUSTOMER_HISTORY", parseLocalDate("2031-09-01"));
        expect(again.placement).toBeNull();
      });
    });

    it("replaces a rate for the same unit and day, keeps others, and says who checked it", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({
          phone: "+972500007031",
          givenName: "שקד",
          familyName: "מנס",
          birthDate: null,
        });
        const september = parseLocalDate("2026-09-01");
        const fifteenth = parseLocalDate("2026-09-15");

        const corrected = await repositories.unitRates.set(
          { unit: "WHATSAPP_UTILITY", effectiveFrom: september, perUnit: microShekels(20_300), source: "חשבונית ספטמבר" },
          admin.id,
        );
        expect(corrected).toMatchObject({ perUnit: 20_300, source: "חשבונית ספטמבר", checkedBy: "שקד מנס" });
        await repositories.unitRates.set(
          { unit: "WHATSAPP_UTILITY", effectiveFrom: fifteenth, perUnit: microShekels(21_000), source: "חשבונית, שורה 4" },
          admin.id,
        );

        const utility = (await repositories.unitRates.list()).filter((rate) => rate.unit === "WHATSAPP_UTILITY");
        expect(utility.map(({ effectiveFrom, perUnit }) => ({ effectiveFrom, perUnit }))).toEqual([
          { effectiveFrom: "2026-09-01", perUnit: 20_300 },
          { effectiveFrom: "2026-09-15", perUnit: 21_000 },
        ]);
        const sms = (await repositories.unitRates.list()).find((rate) => rate.unit === "SMS_SEGMENT");
        expect(sms?.checkedBy).toBeNull();
      });
    });

    it("gives a Grant, finds it with who gave it, lists what still runs, and moves its end", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07032");
        const other = await aBookableBusiness(repositories, "07033");
        const admin = await repositories.users.create({
          phone: "+972500007034",
          givenName: "הנהלה",
          familyName: null,
          birthDate: null,
        });
        const shop = context.business.id;

        const history = await repositories.grants.create({
          businessId: shop,
          feature: "CUSTOMER_HISTORY",
          reason: "פיילוט",
          endsOn: parseLocalDate("2031-03-20"),
          grantedBy: admin.id,
        });
        expect(history).toMatchObject({ businessId: shop, feature: "CUSTOMER_HISTORY", reason: "פיילוט", grantedByName: "הנהלה" });
        const waiting = await repositories.grants.create({
          businessId: shop,
          feature: "WAITING_LIST",
          reason: "הטרדות",
          endsOn: parseLocalDate("2031-03-10"),
          grantedBy: admin.id,
        });
        await repositories.grants.create({
          businessId: other.business.id,
          feature: "TEAM_ROLES",
          reason: "אחר",
          endsOn: parseLocalDate("2031-03-01"),
          grantedBy: admin.id,
        });

        expect(await repositories.grants.findById(history.id)).toEqual(history);
        expect((await repositories.grants.listForBusiness(shop)).map((grant) => grant.feature)).toEqual([
          "CUSTOMER_HISTORY",
          "WAITING_LIST",
        ]);
        const running = (await repositories.grants.listRunning(parseLocalDate("2031-03-05"))).map((grant) => grant.id);
        expect(running).toContain(history.id);
        expect(running).toContain(waiting.id);
        expect((await repositories.grants.listRunning(parseLocalDate("2031-03-11"))).map((grant) => grant.id)).not.toContain(
          waiting.id,
        );

        const extended = await repositories.grants.update(waiting.id, {
          endsOn: parseLocalDate("2031-04-10"),
          reason: "עוד חודש",
        });
        expect(extended).toMatchObject({ endsOn: "2031-04-10", reason: "עוד חודש", grantedByName: "הנהלה" });
        // What the Entitlement reads sees it too.
        const basis = await repositories.subscriptions.entitlementBasis(shop);
        expect(basis?.grants).toContainEqual({ feature: "WAITING_LIST", endsOn: "2031-04-10" });
      });
    });

    // --- Add-ons (ADR 0021) ----------------------------------------------

    it("sells an Add-on, sends a rise on its way, stops it — and never has more than two on sale", async () => {
      await withRepositories(async (repositories) => {
        const since = parseLocalDate("2031-03-01");
        const history = await repositories.addonOffers.put({
          feature: "CUSTOMER_HISTORY",
          price: money(1900),
          since,
          stoppedOn: null,
          rise: null,
        });
        expect(await repositories.addonOffers.list()).toEqual([history]);

        const rise = {
          from: money(1900),
          announcedOn: since,
          firstOn: parseLocalDate("2031-04-01"),
          lastOn: parseLocalDate("2031-04-20"),
        };
        const rising = await repositories.addonOffers.put({ ...history, price: money(2400), rise });
        expect(rising).toEqual({ ...history, price: 2400, rise });

        const stopped = await repositories.addonOffers.put({ ...rising, stoppedOn: parseLocalDate("2031-03-05") });
        expect(stopped.stoppedOn).toBe("2031-03-05");
        for (const feature of ["TEAM_ROLES", "WAITING_LIST"] as const) {
          await repositories.addonOffers.put({ feature, price: money(900), since, stoppedOn: null, rise: null });
        }
        expect((await repositories.addonOffers.list()).map((offer) => offer.feature)).toEqual([
          "CUSTOMER_HISTORY",
          "TEAM_ROLES",
          "WAITING_LIST",
        ]);

        // A third on sale is refused. Last, because a refused statement ends the transaction.
        await expect(repositories.addonOffers.put({ ...stopped, stoppedOn: null })).rejects.toMatchObject({
          code: "CONFLICT",
        });
      });
    });

    it("keeps an administrator's Add-ons and the days owed, and settles them with a payment", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07051");
        const shop = context.business.id;
        const admin = await repositories.users.create({ phone: "+972500007052", givenName: "הנהלה", familyName: null, birthDate: null });
        const addedOn = parseLocalDate("2031-03-02");

        const held = await repositories.addonHoldings.add({
          businessId: shop,
          feature: "WAITING_LIST",
          addedOn,
          paysFrom: parseLocalDate("2031-04-01"),
          price: money(1500),
        });
        expect(held).toMatchObject({ businessId: shop, feature: "WAITING_LIST", price: 1500, nextPrice: null, endsOn: null, ending: null });

        const cancelled = await repositories.addonHoldings.end(held.id, { endsOn: parseLocalDate("2031-03-31"), ending: "CANCELLED" });
        expect(cancelled).toMatchObject({ endsOn: "2031-03-31", ending: "CANCELLED" });
        expect(await repositories.addonHoldings.resume(held.id)).toMatchObject({ endsOn: null, ending: null });

        const nextPrice = { price: money(2000), effectiveOn: parseLocalDate("2031-05-01") };
        await repositories.addonHoldings.setPrices([{ id: held.id, price: money(1200), nextPrice }]);
        expect(await repositories.addonHoldings.listForBusiness(shop)).toEqual([{ ...held, price: 1200, nextPrice }]);
        expect((await repositories.addonHoldings.listRunning(addedOn)).map((holding) => holding.id)).toContain(held.id);

        // What every Feature check reads carries it, and no Trial: nothing started one.
        const basis = await repositories.subscriptions.entitlementBasis(shop);
        expect(basis?.addons).toEqual([{ feature: "WAITING_LIST", addedOn: "2031-03-02", endsOn: null }]);
        expect(basis?.trialEndsOn).toBeNull();

        const owed = await repositories.daysOwed.add({
          businessId: shop,
          kind: "PLAN_DAYS",
          subject: "TEAM",
          amount: money(2000),
          from: parseLocalDate("2031-03-12"),
          through: parseLocalDate("2031-03-26"),
        });
        expect(await repositories.daysOwed.listOwed(shop)).toEqual([owed]);
        const subscription = await repositories.subscriptions.findByBusiness(shop);
        if (subscription === null) throw new Error("No subscription");
        const payment = await repositories.payments.create({
          subscriptionId: subscription.id,
          businessId: shop,
          amount: money(6900),
          paidOn: parseLocalDate("2031-03-27"),
          recordedBy: admin.id,
          note: null,
        });
        await repositories.daysOwed.settle(shop, payment.id);
        expect(await repositories.daysOwed.listOwed(shop)).toEqual([]);
      });
    });

    it("lets an owner add their own Add-on at the price on sale, cancel, resume it, and owe days", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "07053");
        const shop = context.business.id;
        const addedOn = parseLocalDate("2031-03-02");
        await repositories.addonOffers.put({ feature: "CUSTOMER_HISTORY", price: money(1900), since: addedOn, stoppedOn: null, rise: null });

        await actAs(context.owner.id);
        // Whatever price the caller names, the sale's is kept.
        const added = await repositories.addonHoldings.addAsOwner({
          businessId: shop,
          feature: "CUSTOMER_HISTORY",
          addedOn,
          paysFrom: parseLocalDate("2031-04-01"),
          price: money(1),
        });
        expect(added).toMatchObject({ feature: "CUSTOMER_HISTORY", price: 1900, ending: null });

        const ending = { endsOn: parseLocalDate("2031-03-31"), ending: "CANCELLED" as const };
        expect(await repositories.addonHoldings.endAsOwner(shop, added.id, ending)).toMatchObject(ending);
        expect(await repositories.addonHoldings.resumeAsOwner(shop, added.id)).toMatchObject({ endsOn: null, ending: null });

        const owed = await repositories.daysOwed.add({
          businessId: shop,
          kind: "ADDON_DAYS",
          subject: "CUSTOMER_HISTORY",
          amount: money(950),
          from: parseLocalDate("2031-03-12"),
          through: parseLocalDate("2031-03-26"),
        });
        expect(await repositories.daysOwed.listOwed(shop)).toEqual([owed]);

        await repositories.subscriptions.holdPlan(shop, "TEAM");
        await repositories.subscriptions.holdPlan(shop, "TEAM");
        expect(await repositories.subscriptions.plansHeld(shop)).toEqual(["TEAM"]);
      });
    });

    it("records usage and adds it up per Business, source, unit and UTC day, within the span", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07009");
        const morning = AT("2031-03-10T08:00:00.000Z");
        const evening = AT("2031-03-10T20:00:00.000Z");
        const nextDay = AT("2031-03-11T08:00:00.000Z");
        const outside = AT("2031-04-10T10:00:00.000Z");
        const shop = context.business.id;
        await repositories.usageRecords.record([]);
        await repositories.usageRecords.record([
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", quantity: 1, occurredAt: morning },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", quantity: 1, occurredAt: evening },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", quantity: 1, occurredAt: nextDay },
          { businessId: shop, source: "WAITING_LIST", unit: "SMS_SEGMENT", quantity: 2, occurredAt: morning },
          { businessId: null, source: "SIGN_IN", unit: "WHATSAPP_AUTHENTICATION", quantity: 1, occurredAt: morning },
          { businessId: shop, source: "BILLING", unit: "WHATSAPP_UTILITY", quantity: 1, occurredAt: morning },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", quantity: 1, occurredAt: outside },
        ]);

        const summary = await repositories.usageRecords.summarise(
          AT("2031-03-01T00:00:00.000Z"),
          AT("2031-04-01T00:00:00.000Z"),
        );

        expect(summary).toEqual([
          { businessId: null, source: "SIGN_IN", unit: "WHATSAPP_AUTHENTICATION", day: "2031-03-10", quantity: 1, messages: 1 },
          { businessId: shop, source: "BILLING", unit: "WHATSAPP_UTILITY", day: "2031-03-10", quantity: 1, messages: 1 },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", day: "2031-03-10", quantity: 2, messages: 2 },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", day: "2031-03-11", quantity: 1, messages: 1 },
          // One SMS in two parts: billed as two, sent as one.
          { businessId: shop, source: "WAITING_LIST", unit: "SMS_SEGMENT", day: "2031-03-10", quantity: 2, messages: 1 },
        ]);
      });
    });

    // --- What Businesses and the platform cost: ADR 0023 ---------------

    it("keeps a Fair Use Limit per cause and one for sign-in codes, and changes each alone", async () => {
      await withRepositories(async (repositories) => {
        expect(await repositories.fairUseLimits.get()).toEqual({
          perBusiness: { BOOKING: 12_000, REMINDERS: 10_000, WAITING_LIST: 1_000 },
          signInPerDay: 300,
        });
        expect(await repositories.fairUseLimits.setBusinessLimit("WAITING_LIST", money(2_500))).toEqual({
          perBusiness: { BOOKING: 12_000, REMINDERS: 10_000, WAITING_LIST: 2_500 },
          signInPerDay: 300,
        });
        expect(await repositories.fairUseLimits.setSignInLimit(450)).toEqual({
          perBusiness: { BOOKING: 12_000, REMINDERS: 10_000, WAITING_LIST: 2_500 },
          signInPerDay: 450,
        });
        expect((await repositories.fairUseLimits.get()).signInPerDay).toBe(450);
      });
    });

    const aUse = (calendars: number, bookingWhatsapp: number) => ({
      calendars,
      BOOKING: { whatsapp: bookingWhatsapp, sms: 3 },
      REMINDERS: { whatsapp: 10, sms: 0 },
      WAITING_LIST: { whatsapp: 0, sms: 1 },
      BILLING: { whatsapp: 2, sms: 0 },
    });

    it("starts with the two saved Businesses, and saves, updates, renames and deletes one", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077301", givenName: "מנהלת", familyName: null, birthDate: null });
        const seeded = await repositories.referenceBusinesses.list();
        expect(seeded.map((one) => [one.name, one.use.calendars])).toEqual([
          ["בינוני", 1],
          ["עמוס", 4],
        ]);
        expect(seeded[1]?.use.REMINDERS).toEqual({ whatsapp: 891, sms: 9 });

        const saved = await repositories.referenceBusinesses.create({
          name: "מספרה עם 3 כיסאות",
          use: aUse(3, 500),
          savedOn: parseLocalDate("2031-03-10"),
          savedBy: admin.id,
        });
        expect(saved).toMatchObject({ name: "מספרה עם 3 כיסאות", use: aUse(3, 500), savedOn: "2031-03-10" });

        const updated = await repositories.referenceBusinesses.update(saved.id, {
          use: aUse(2, 900),
          savedOn: parseLocalDate("2031-03-11"),
          savedBy: admin.id,
        });
        expect(updated).toMatchObject({ id: saved.id, name: "מספרה עם 3 כיסאות", use: aUse(2, 900), savedOn: "2031-03-11" });

        const renamed = await repositories.referenceBusinesses.rename(saved.id, "שלושה כיסאות");
        expect(renamed).toMatchObject({ id: saved.id, name: "שלושה כיסאות", use: aUse(2, 900) });

        expect((await repositories.referenceBusinesses.list()).map((one) => one.name)).toEqual([
          "בינוני",
          "עמוס",
          "שלושה כיסאות",
        ]);
        await repositories.referenceBusinesses.delete(saved.id);
        expect((await repositories.referenceBusinesses.list()).map((one) => one.name)).toEqual(["בינוני", "עמוס"]);
      });
    });

    it("refuses a saved Business a name another has, in any case", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077302", givenName: "מנהלת", familyName: null, birthDate: null });
        await repositories.referenceBusinesses.create({
          name: "Busy Salon",
          use: aUse(1, 1),
          savedOn: parseLocalDate("2031-03-10"),
          savedBy: admin.id,
        });
        await expect(
          repositories.referenceBusinesses.create({
            name: "busy salon",
            use: aUse(1, 1),
            savedOn: parseLocalDate("2031-03-10"),
            savedBy: admin.id,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { field: "name" } });
      });
    });

    it("refuses renaming a saved Business to another's name", async () => {
      await withRepositories(async (repositories) => {
        const [medium] = await repositories.referenceBusinesses.list();
        await expect(repositories.referenceBusinesses.rename(medium?.id ?? asId(""), " עמוס ".trim())).rejects.toMatchObject({
          code: "VALIDATION_FAILED",
          details: { field: "name" },
        });
      });
    });

    it("keeps eight saved Businesses at most", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077303", givenName: "מנהלת", familyName: null, birthDate: null });
        for (let at = 0; at < 6; at += 1) {
          await repositories.referenceBusinesses.create({
            name: `דוגמה ${at}`,
            use: aUse(1, at),
            savedOn: parseLocalDate("2031-03-10"),
            savedBy: admin.id,
          });
        }
        expect(await repositories.referenceBusinesses.list()).toHaveLength(8);
        await expect(
          repositories.referenceBusinesses.create({
            name: "התשיעית",
            use: aUse(1, 1),
            savedOn: parseLocalDate("2031-03-10"),
            savedBy: admin.id,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      });
    });

    it("says a saved Business that is gone is not found, to update, rename or delete", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077304", givenName: "מנהלת", familyName: null, birthDate: null });
        const gone = asId<"ReferenceBusiness">("00000000-0000-4000-8000-00000000d0d0");
        await expect(
          repositories.referenceBusinesses.update(gone, { use: aUse(1, 1), savedOn: parseLocalDate("2031-03-10"), savedBy: admin.id }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(repositories.referenceBusinesses.rename(gone, "שם חדש")).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(repositories.referenceBusinesses.delete(gone)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });

    it("keeps each running cost's amounts by day, replacing one for the same day and keeping the rest", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077305", givenName: "מנהלת", familyName: null, birthDate: null });
        expect(await repositories.runningCosts.list()).toEqual([]);
        const hosting = await repositories.runningCosts.create(
          "Supabase",
          { effectiveFrom: parseLocalDate("2031-03-01"), amount: money(9_250), source: "invoice February" },
          admin.id,
        );
        expect(hosting).toMatchObject({
          name: "Supabase",
          amounts: [{ effectiveFrom: "2031-03-01", amount: 9_250, source: "invoice February" }],
        });
        await repositories.runningCosts.setAmount(
          hosting.id,
          { effectiveFrom: parseLocalDate("2031-05-01"), amount: money(0), source: "cancelled" },
          admin.id,
        );
        const corrected = await repositories.runningCosts.setAmount(
          hosting.id,
          { effectiveFrom: parseLocalDate("2031-03-01"), amount: money(9_990), source: "invoice February, corrected" },
          admin.id,
        );
        expect(corrected.amounts).toEqual([
          { effectiveFrom: "2031-03-01", amount: 9_990, source: "invoice February, corrected" },
          { effectiveFrom: "2031-05-01", amount: 0, source: "cancelled" },
        ]);
        await repositories.runningCosts.create(
          "Vercel",
          { effectiveFrom: parseLocalDate("2031-03-01"), amount: money(7_400), source: "invoice February" },
          admin.id,
        );
        expect((await repositories.runningCosts.list()).map((cost) => [cost.name, cost.amounts.length])).toEqual([
          ["Supabase", 2],
          ["Vercel", 1],
        ]);
      });
    });

    it("refuses a second running cost of the same name, in any case", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077306", givenName: "מנהלת", familyName: null, birthDate: null });
        const first = { effectiveFrom: parseLocalDate("2031-03-01"), amount: money(100), source: "invoice" };
        await repositories.runningCosts.create("Domain", first, admin.id);
        await expect(repositories.runningCosts.create(" domain ".trim(), first, admin.id)).rejects.toMatchObject({
          code: "VALIDATION_FAILED",
          details: { field: "name" },
        });
      });
    });

    it("says a running cost that does not exist is not found", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({ phone: "+972500077307", givenName: "מנהלת", familyName: null, birthDate: null });
        await expect(
          repositories.runningCosts.setAmount(
            asId("00000000-0000-4000-8000-00000000c0c0"),
            { effectiveFrom: parseLocalDate("2031-03-01"), amount: money(100), source: "invoice" },
            admin.id,
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });

    // --- Notices: ADR 0020 ---------------------------------------------

    it("keeps a Notice once per key, and lists the newest first", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07020");
        const shop = context.business.id;
        const ending = { kind: "TRIAL_ENDING", trialEndsOn: parseLocalDate("2031-03-20") } as const;

        const first = await repositories.notices.post({ businessId: shop, facts: ending, key: "TRIAL_ENDING:2031-03-20" });
        expect(first).toMatchObject({ businessId: shop, facts: ending, readAt: null, clearedAt: null });
        // The daily run seeing the same thing tomorrow keeps nothing more.
        expect(await repositories.notices.post({ businessId: shop, facts: ending, key: "TRIAL_ENDING:2031-03-20" })).toBeNull();

        const paid = { kind: "PAYMENT_RECORDED", paidThrough: parseLocalDate("2031-04-20") } as const;
        // An event has no key, and two of them are two Notices.
        await repositories.notices.post({ businessId: shop, facts: paid, key: null });
        const last = await repositories.notices.post({ businessId: shop, facts: paid, key: null });

        const listed = await repositories.notices.listForBusiness(shop, 10);
        expect(listed.map((notice) => notice.facts.kind)).toEqual(["PAYMENT_RECORDED", "PAYMENT_RECORDED", "TRIAL_ENDING"]);
        expect(listed[0]?.id).toBe(last?.id);
        expect(await repositories.notices.listForBusiness(shop, 1)).toHaveLength(1);
      });
    });

    it("clears standing banners by kind, acknowledges one, and reads the rest", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07021");
        const other = await aBookableBusiness(repositories, "07022");
        const shop = context.business.id;
        const at = AT("2031-03-10T10:00:00.000Z");
        const later = AT("2031-03-11T10:00:00.000Z");
        const late = { kind: "PAYMENT_LATE", graceEndsOn: parseLocalDate("2031-03-24") } as const;
        const paused = { kind: "CALENDARS_PAUSED", names: ["שני"], resourceAllowance: 1 } as const;

        const lateNotice = await repositories.notices.post({ businessId: shop, facts: late, key: "a" });
        const pausedNotice = await repositories.notices.post({ businessId: shop, facts: paused, key: null });
        const elsewhere = await repositories.notices.post({ businessId: other.business.id, facts: late, key: "a" });
        if (lateNotice === null || pausedNotice === null || elsewhere === null) throw new Error("Not kept");

        await repositories.notices.clear(shop, [], at);
        await repositories.notices.clear(shop, ["PAYMENT_LATE"], at);
        await repositories.notices.clear(shop, ["PAYMENT_LATE"], later);
        const byId = async (businessId: typeof shop) =>
          new Map((await repositories.notices.listForBusiness(businessId, 10)).map((notice) => [notice.id, notice]));
        expect((await byId(shop)).get(lateNotice.id)?.clearedAt).toBe(at);
        expect((await byId(shop)).get(pausedNotice.id)?.clearedAt).toBeNull();
        expect((await byId(other.business.id)).get(elsewhere.id)?.clearedAt).toBeNull();

        const acknowledged = await repositories.notices.acknowledge(shop, pausedNotice.id, at);
        expect(acknowledged).toMatchObject({ clearedAt: at, readAt: at, facts: paused });
        // Somebody else's Notice is not acknowledged from here.
        expect(await repositories.notices.acknowledge(shop, elsewhere.id, at)).toBeNull();

        await repositories.notices.markAllRead(shop, later);
        const read = await byId(shop);
        expect(read.get(lateNotice.id)?.readAt).toBe(later);
        expect(read.get(pausedNotice.id)?.readAt).toBe(at);
        expect((await byId(other.business.id)).get(elsewhere.id)?.readAt).toBeNull();
      });
    });

    it("lets an owner keep a Notice of their own act, and read and acknowledge their own", async () => {
      await withRepositories(async (repositories, actAs) => {
        const context = await aBookableBusiness(repositories, "07023");
        const shop = context.business.id;
        await actAs(context.owner.id);

        const changed = await repositories.notices.post({
          businessId: shop,
          facts: {
            kind: "PLAN_CHANGED",
            plan: "TEAM",
            by: "OWNER",
            priceMinor: 8900,
            resourceAllowance: 5,
            gained: ["CUSTOMER_HISTORY"],
            lost: [],
          },
          key: null,
        });
        expect(changed?.facts.kind).toBe("PLAN_CHANGED");
        const at = AT("2031-03-10T10:00:00.000Z");
        await repositories.notices.markAllRead(shop, at);
        const listed = await repositories.notices.listForBusiness(shop, 10);
        expect(listed.map((notice) => notice.readAt)).toEqual([at]);
        if (changed === null) throw new Error("Not kept");
        expect((await repositories.notices.acknowledge(shop, changed.id, at))?.clearedAt).toBe(at);
      });
    });

    it("lists a paid subscription as lapsed only past its grace period", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07002");
        const paidThrough = parseLocalDate("2026-09-01");
        await repositories.subscriptions.update(context.business.id, { paidThrough });

        const lapsedIds = async (today: LocalDate) =>
          (await repositories.subscriptions.listLapsed(today)).map((subscription) => subscription.businessId);
        expect(await lapsedIds(addDays(paidThrough, 3))).not.toContain(context.business.id);
        expect(await lapsedIds(addDays(paidThrough, 4))).toContain(context.business.id);
      });
    });

    it("lists an unpaid Trial as lapsed the day after it ends, with no grace", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07007");
        const trialEndsOn = parseLocalDate("2026-09-30");
        await repositories.subscriptions.update(context.business.id, { trialEndsOn });

        const lapsedIds = async (today: LocalDate) =>
          (await repositories.subscriptions.listLapsed(today)).map((subscription) => subscription.businessId);
        expect(await lapsedIds(trialEndsOn)).not.toContain(context.business.id);
        expect(await lapsedIds(addDays(trialEndsOn, 1))).toContain(context.business.id);
      });
    });

    // --- Allowlist: ADR 0010 --------------------------------------------

    it("adds, finds and removes an allowlisted number", async () => {
      await withRepositories(async (repositories) => {
        const admin = await repositories.users.create({
          phone: "+972500008888",
          givenName: "הנהלה",
          familyName: null,
          birthDate: null,
        });
        expect(await repositories.administratorAllowlist.contains("+972500009999")).toBe(false);

        await repositories.administratorAllowlist.add("+972500009999", "note", admin.id);
        expect(await repositories.administratorAllowlist.contains("+972500009999")).toBe(true);

        await repositories.administratorAllowlist.remove("+972500009999");
        expect(await repositories.administratorAllowlist.contains("+972500009999")).toBe(false);
      });
    });


    it("gives a block back by its id, so what a deletion frees is knowable", async () => {
      await withRepositories(async (repositories) => {
        const { business, resource } = await aBookableBusiness(repositories, "4107");
        const block = await repositories.blocks.create({
          resourceId: resource.id,
          businessId: business.id,
          startAt: AT("2026-09-21T06:00:00.000Z"),
          endAt: AT("2026-09-21T09:00:00.000Z"),
          reason: "מילואים",
          groupId: crypto.randomUUID(),
        });

        expect(await repositories.blocks.findById(block.id)).toEqual(block);
        await repositories.blocks.delete(block.id);
        expect(await repositories.blocks.findById(block.id)).toBeNull();
      });
    });

    // --- Waiting for a time ---------------------------------------------

    describe("waiting for a time", () => {
      const aWaitingCustomer = async (repositories: Repositories, suffix: string) => {
        const shop = await aBookableBusiness(repositories, suffix);
        const customer = await repositories.users.create({
          phone: `+972520000${suffix}`,
          givenName: "דנה",
          familyName: "כהן",
          birthDate: null,
        });
        return { ...shop, customer };
      };

      it("keeps the question a customer asked, and gives it back", async () => {
        await withRepositories(async (repositories) => {
          const { business, service, resource, customer } =
            await aWaitingCustomer(repositories, "4101");
          const onDate = parseLocalDate("2026-09-21");

          const entry = await repositories.waitingEntries.put({
            businessId: business.id,
            customerId: customer.id,
            serviceId: service.id,
            resourceIds: [resource.id],
            onDate,
            parts: ["MORNING", "EVENING"],
          });

          expect(entry.parts).toEqual(["MORNING", "EVENING"]);
          expect(entry.resourceIds).toEqual([resource.id]);
          expect(entry.closedAt).toBeNull();
          expect(entry.lastNotifiedAt).toBeNull();

          const found = await repositories.waitingEntries.findById(entry.id);
          expect(found).toEqual(entry);

          expect(
            await repositories.waitingEntries.openForCustomer(customer.id, onDate),
          ).toEqual([entry]);
        });
      });

      it("gives a customer's open entries with the names their list shows", async () => {
        await withRepositories(async (repositories) => {
          const here = await aWaitingCustomer(repositories, "4109");
          const there = await aBookableBusiness(repositories, "4110");
          const second = await repositories.resources.create({
            businessId: here.business.id,
            name: "יומן ב",
          });
          const onDate = parseLocalDate("2026-09-21");

          const mine = await repositories.waitingEntries.put({
            businessId: here.business.id,
            customerId: here.customer.id,
            serviceId: here.service.id,
            resourceIds: [here.resource.id, second.id],
            onDate,
            parts: ["MORNING"],
          });
          // A second shop, so the narrowing has something to leave out.
          await repositories.waitingEntries.put({
            businessId: there.business.id,
            customerId: here.customer.id,
            serviceId: there.service.id,
            resourceIds: [there.resource.id],
            onDate,
            parts: ["EVENING"],
          });

          const all = await repositories.waitingEntries.openForCustomerNamed(
            here.customer.id,
            onDate,
            null,
          );

          expect(all).toHaveLength(2);
          const held = all.find((one) => one.entry.id === mine.id);
          // The three names the loop this replaced fetched one read at a time.
          expect(held?.businessName).toBe(here.business.name);
          expect(held?.serviceName).toBe(here.service.name);
          expect(held?.businessTimeZone).toBe("Asia/Jerusalem");
          // In the entry's own order, so the chip reads the way it was asked.
          expect(held?.resourceNames).toEqual(
            held?.entry.resourceIds.map((id) =>
              id === second.id ? "יומן ב" : here.resource.name,
            ),
          );

          // One shop's worth, for the screen that draws one shop.
          const narrowed = await repositories.waitingEntries.openForCustomerNamed(
            here.customer.id,
            onDate,
            here.business.id,
          );
          expect(narrowed.map((one) => one.entry.id)).toEqual([mine.id]);

          // A closed entry is nobody's standing question any more.
          await repositories.waitingEntries.close([mine.id], AT("2026-09-20T10:00:00.000Z"));
          expect(
            await repositories.waitingEntries.openForCustomerNamed(
              here.customer.id,
              onDate,
              here.business.id,
            ),
          ).toEqual([]);
        });
      });

      /**
       * Asking twice is the same ask, and changing one's mind replaces the
       * question rather than raising a second one. Two open rows would mean
       * two messages for one opening.
       */
      it("keeps one open entry per service and day, rewritten in place", async () => {
        await withRepositories(async (repositories) => {
          const { business, service, resource, customer } =
            await aWaitingCustomer(repositories, "4102");
          const other = await repositories.resources.create({
            businessId: business.id,
            name: "כיסא שני",
          });
          const draft = {
            businessId: business.id,
            customerId: customer.id,
            serviceId: service.id,
            resourceIds: [resource.id],
            onDate: parseLocalDate("2026-09-21"),
            parts: ["MORNING"] as const,
          };

          const first = await repositories.waitingEntries.put(draft);
          const again = await repositories.waitingEntries.put({
            ...draft,
            parts: ["EVENING"],
            resourceIds: [resource.id, other.id],
          });

          expect(again.id).toBe(first.id);
          expect(again.parts).toEqual(["EVENING"]);
          expect([...again.resourceIds].sort()).toEqual([resource.id, other.id].sort());
          expect(
            await repositories.waitingEntries.openForCustomer(
              customer.id,
              parseLocalDate("2026-09-21"),
            ),
          ).toHaveLength(1);

          // Closed, it is out of the way and the customer may ask afresh.
          await repositories.waitingEntries.close([first.id], AT("2026-09-20T10:00:00.000Z"));
          const later = await repositories.waitingEntries.put(draft);
          expect(later.id).not.toBe(first.id);
        });
      });

      it("tells whoever waits on the calendar that freed, and nobody else", async () => {
        await withRepositories(async (repositories) => {
          const { business, service, resource, customer } =
            await aWaitingCustomer(repositories, "4103");
          const other = await repositories.resources.create({
            businessId: business.id,
            name: "כיסא שני",
          });
          const onDate = parseLocalDate("2026-09-21");

          const entry = await repositories.waitingEntries.put({
            businessId: business.id,
            customerId: customer.id,
            serviceId: service.id,
            resourceIds: [resource.id],
            onDate,
            parts: ["MORNING"],
          });

          const never = AT("1970-01-01T00:00:00.000Z");
          const told = await repositories.waitingEntries.toTell(resource.id, onDate, never);
          expect(told).toHaveLength(1);
          expect(told[0]!.entry.id).toBe(entry.id);
          expect(told[0]!.customerPhone).toBe(`+9725200004103`);
          expect(told[0]!.serviceName).toBe("שירות");
          expect(told[0]!.businessName).toBe("עסק 4103");
          expect(told[0]!.businessTimeZone).toBe("Asia/Jerusalem");

          expect(await repositories.waitingEntries.toTell(other.id, onDate, never)).toEqual([]);
          expect(
            await repositories.waitingEntries.toTell(
              resource.id,
              parseLocalDate("2026-09-22"),
              never,
            ),
          ).toEqual([]);
        });
      });

      /**
       * ADR 0013's trick, applied to a second job: the stamp on the row is what
       * stops a day that frees up repeatedly becoming a stream of messages, and
       * it does so without querying the outbox.
       */
      it("passes over an entry told about an opening recently", async () => {
        await withRepositories(async (repositories) => {
          const { business, service, resource, customer } =
            await aWaitingCustomer(repositories, "4104");
          const onDate = parseLocalDate("2026-09-21");
          const entry = await repositories.waitingEntries.put({
            businessId: business.id,
            customerId: customer.id,
            serviceId: service.id,
            resourceIds: [resource.id],
            onDate,
            parts: ["MORNING"],
          });

          await repositories.waitingEntries.markNotified(
            [entry.id],
            AT("2026-09-20T09:00:00.000Z"),
          );

          expect(
            await repositories.waitingEntries.toTell(
              resource.id,
              onDate,
              AT("2026-09-20T08:00:00.000Z"),
            ),
          ).toEqual([]);
          expect(
            await repositories.waitingEntries.toTell(
              resource.id,
              onDate,
              AT("2026-09-20T12:00:00.000Z"),
            ),
          ).toHaveLength(1);
        });
      });

      it("closes what a customer was waiting for once they have booked it", async () => {
        await withRepositories(async (repositories) => {
          const { business, service, resource, customer } =
            await aWaitingCustomer(repositories, "4105");
          const onDate = parseLocalDate("2026-09-21");
          await repositories.waitingEntries.put({
            businessId: business.id,
            customerId: customer.id,
            serviceId: service.id,
            resourceIds: [resource.id],
            onDate,
            parts: ["MORNING"],
          });

          await repositories.waitingEntries.closeForBooking(
            customer.id,
            business.id,
            service.id,
            onDate,
            AT("2026-09-20T10:00:00.000Z"),
          );

          expect(
            await repositories.waitingEntries.openForCustomer(customer.id, onDate),
          ).toEqual([]);
        });
      });

      /**
       * A mark says only "look at this calendar's day again". Marking twice is
       * one mark, because the work is the same however many edits asked for it.
       */
      it("collapses repeated marks on one day, and hands them back oldest first", async () => {
        await withRepositories(async (repositories) => {
          const { resource } = await aBookableBusiness(repositories, "4106");
          const monday = parseLocalDate("2026-09-21");
          const tuesday = parseLocalDate("2026-09-22");

          await repositories.waitingRechecks.mark(resource.id, monday);
          await repositories.waitingRechecks.mark(resource.id, monday);
          await repositories.waitingRechecks.mark(resource.id, tuesday);

          const waiting = await repositories.waitingRechecks.oldest(10);
          expect(waiting).toEqual([
            { resourceId: resource.id, onDate: monday },
            { resourceId: resource.id, onDate: tuesday },
          ]);

          await repositories.waitingRechecks.clear([waiting[0]!]);
          expect(await repositories.waitingRechecks.oldest(10)).toEqual([
            { resourceId: resource.id, onDate: tuesday },
          ]);
        });
      });
    });

    it("never invents an id it was not given", async () => {
      await withRepositories(async (repositories) => {
        expect(await repositories.users.findById(asId("00000000-0000-4000-8000-999999999999"))).toBeNull();
        expect(
          await repositories.businesses.findById(asId("00000000-0000-4000-8000-999999999999")),
        ).toBeNull();
      });
    });
  });
};
