import { describe, expect, it } from "vitest";
import {
  addDays,
  asId,
  dayOfWeek,
  displayName,
  formatInstant,
  localTime,
  isActive,
  money,
  parseInstant,
  parseLocalDate,
  timeZone,
  type Instant,
  type PhotoSlot,
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
          }),
        ).toMatchObject({ name: "שם חדש", address: "הרצל 1" });

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
        expect(
          await repositories.appointments.listForCustomerAtBusiness(
            context.owner.id,
            context.business.id,
          ),
        ).toHaveLength(1);
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

    it("lists and deletes a block, an override and a working-hours range", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "7105");

        const block = await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: parseInstant("2026-09-16T06:00:00Z"),
          endAt: parseInstant("2026-09-16T08:00:00Z"),
          reason: "ספק",
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

    it("counts blocks the same way, so a day off shows on the grid", async () => {
      await withRepositories(async (repositories) => {
        const context = await aBookableBusiness(repositories, "4104");
        await repositories.blocks.create({
          resourceId: context.resource.id,
          businessId: context.business.id,
          startAt: parseInstant("2026-09-20T06:00:00Z"),
          endAt: parseInstant("2026-09-20T14:00:00Z"),
          reason: "חופשה",
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
