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
        category: null,
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
            category: "barbershop",
          }),
        ).toMatchObject({
          name: "שם חדש",
          address: "הרצל 1",
          latitude: 32.0853,
          longitude: 34.7818,
          category: "barbershop",
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
          category: "barbershop",
        });
        expect(
          await repositories.appointments.listForCustomerWithBusiness(context.owner.id, {
            limit: 10,
            offset: 0,
          }),
        ).toMatchObject([
          {
            businessName: context.business.name,
            businessCategory: "barbershop",
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
        await repositories.dateOverrides.delete(override.id);
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
          category: "barbershop",
          latitude: 32.08,
          longitude: 34.78,
        });
        await repositories.businesses.update(far.business.id, {
          category: "barbershop",
          latitude: 32.79,
          longitude: 34.99,
        });
        await repositories.businesses.update(nails.business.id, { category: "nail_salon" });
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
          features: ["REMINDERS", "CUSTOMER_HISTORY", "CUSTOMER_BLOCKING", "TEAM_ROLES"],
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
        const blocking = await repositories.grants.create({
          businessId: shop,
          feature: "CUSTOMER_BLOCKING",
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
          "CUSTOMER_BLOCKING",
        ]);
        const running = (await repositories.grants.listRunning(parseLocalDate("2031-03-05"))).map((grant) => grant.id);
        expect(running).toContain(history.id);
        expect(running).toContain(blocking.id);
        expect((await repositories.grants.listRunning(parseLocalDate("2031-03-11"))).map((grant) => grant.id)).not.toContain(
          blocking.id,
        );

        const extended = await repositories.grants.update(blocking.id, {
          endsOn: parseLocalDate("2031-04-10"),
          reason: "עוד חודש",
        });
        expect(extended).toMatchObject({ endsOn: "2031-04-10", reason: "עוד חודש", grantedByName: "הנהלה" });
        // What the Entitlement reads sees it too.
        const basis = await repositories.subscriptions.entitlementBasis(shop);
        expect(basis?.grants).toContainEqual({ feature: "CUSTOMER_BLOCKING", endsOn: "2031-04-10" });
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
          { businessId: null, source: "SIGN_IN", unit: "WHATSAPP_AUTHENTICATION", day: "2031-03-10", quantity: 1 },
          { businessId: shop, source: "BILLING", unit: "WHATSAPP_UTILITY", day: "2031-03-10", quantity: 1 },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", day: "2031-03-10", quantity: 2 },
          { businessId: shop, source: "BOOKING", unit: "WHATSAPP_UTILITY", day: "2031-03-11", quantity: 1 },
          { businessId: shop, source: "WAITING_LIST", unit: "SMS_SEGMENT", day: "2031-03-10", quantity: 2 },
        ]);
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
        expect(await lapsedIds(addDays(paidThrough, 14))).not.toContain(context.business.id);
        expect(await lapsedIds(addDays(paidThrough, 15))).toContain(context.business.id);
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
