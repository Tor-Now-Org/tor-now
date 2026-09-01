import { describe, expect, it } from "vitest";
import {
  addDays,
  asId,
  displayName,
  isActive,
  money,
  parseInstant,
  parseLocalDate,
  type Instant,
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
}>;

const AT = (iso: string): Instant => parseInstant(iso);

export const describeRepositoryContract = (
  implementation: string,
  open: RepositoryFactory,
): void => {
  describe(`repository contract (${implementation})`, () => {
    const withRepositories = async (
      body: (repositories: Repositories) => Promise<void>,
    ): Promise<void> => {
      const { repositories, cleanUp } = await open();
      try {
        await body(repositories);
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
        });

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

    // --- Discovery: ADR 0011 --------------------------------------------

    it("finds an active business by part of its name and skips inactive ones", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "06001");
        expect(
          (await repositories.businesses.search(context.business.name)).map(
            (result) => result.business.id,
          ),
        ).toContain(context.business.id);

        await repositories.businesses.setActive(context.business.id, false);
        expect(
          (await repositories.businesses.search(context.business.name)).map(
            (result) => result.business.id,
          ),
        ).not.toContain(context.business.id);
      });
    });

    // --- Billing --------------------------------------------------------

    it("gives every new business a subscription", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07001");
        const subscription = await repositories.subscriptions.findByBusiness(
          context.business.id,
        );
        expect(subscription).not.toBeNull();
      });
    });

    it("lists a subscription as lapsed only past its grace period", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "07002");
        const paidThrough = parseLocalDate("2026-09-01");
        await repositories.subscriptions.update(context.business.id, {
          plan: "STANDARD",
          paidThrough,
        });

        const inGrace = addDays(paidThrough, 10);
        const lapsed = addDays(paidThrough, 20);

        expect(
          (await repositories.subscriptions.listLapsed(inGrace)).map(
            (subscription) => subscription.businessId,
          ),
        ).not.toContain(context.business.id);
        expect(
          (await repositories.subscriptions.listLapsed(lapsed)).map(
            (subscription) => subscription.businessId,
          ),
        ).toContain(context.business.id);
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
