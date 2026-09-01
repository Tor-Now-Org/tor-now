import {
  compareByName,
  displayName,
  END_OF_DAY,
  MIDNIGHT,
  notFound,
  parseInstant,
  parseLocalDate,
  validationFailed,
  zonedToInstant,
  type Appointment,
  type Block,
  type BlockId,
  type BusinessId,
  type ResourceId,
  type User,
} from "@tor-now/domain";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { loadOwnedBusiness, loadOwnedResource } from "./authorization.ts";

/**
 * The owner's view of their own Business: the day's appointments, the Blocks
 * carved out of it, and the customers who have booked.
 *
 * ADR 0003 declines to keep this live. It is fetched on open and on refresh;
 * Supabase Realtime could deliver it and deliberately does not, because the
 * case it buys is a calendar left open unattended.
 */

export type CalendarDay = {
  readonly date: string;
  readonly appointments: readonly (Appointment & { customerName: string; customerPhone: string })[];
  readonly blocks: readonly Block[];
};

export const calendarService = ({ unitOfWork }: { unitOfWork: UnitOfWork }) => ({
  async day(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    date: string,
  ): Promise<CalendarDay> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      const on = parseLocalDate(date);
      const from = zonedToInstant(on, MIDNIGHT, business.timeZone);
      const to = zonedToInstant(on, END_OF_DAY, business.timeZone);

      const [appointments, blocks] = await Promise.all([
        repositories.appointments.listForResourceBetween(resourceId, from, to),
        repositories.blocks.listForResourceBetween(resourceId, from, to),
      ]);

      // An owner needs the customer's name and number on the card; the join is
      // done here rather than in the repository so the appointment stays the
      // shape the domain defined.
      const customers = await loadCustomers(
        repositories,
        appointments.map((appointment) => appointment.customerId),
      );

      return {
        date: on,
        blocks,
        appointments: appointments.map((appointment) => {
          const customer = customers.get(appointment.customerId);
          return {
            ...appointment,
            customerName: customer === undefined ? "—" : displayName(customer),
            customerPhone: customer?.phone ?? "",
          };
        }),
      };
    });
  },

  async createBlock(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    input: { startAt: string; endAt: string; reason: string },
  ): Promise<Block> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);

      const startAt = parseInstant(input.startAt);
      const endAt = parseInstant(input.endAt);
      if (endAt <= startAt) {
        throw validationFailed("A block must end after it starts");
      }

      return repositories.blocks.create({
        resourceId,
        businessId,
        startAt,
        endAt,
        reason: input.reason,
      });
    });
  },

  async deleteBlock(
    actor: Actor,
    businessId: BusinessId,
    blockId: BlockId,
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await repositories.blocks.delete(blockId);
    });
  },

  /** The Business's customers: Users seen through a Membership with that role. */
  async customers(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const memberships = await repositories.memberships.listForBusiness(
        businessId,
        "CUSTOMER",
      );
      const users = await loadCustomers(
        repositories,
        memberships.map((membership) => membership.userId),
      );
      return memberships
        .map((membership) => users.get(membership.userId))
        .filter((user): user is User => user !== undefined && user.deletedAt === null)
        .sort(compareByName);
    });
  },

  /**
   * One customer's history with this Business, which is what a "customer
   * record" is — always relative to a Business, never in the abstract.
   */
  async customerRecord(
    actor: Actor,
    businessId: BusinessId,
    customerId: User["id"],
  ) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const membership = await repositories.memberships.find(customerId, businessId);
      if (membership === null) throw notFound("Customer", customerId);

      const [user, appointments] = await Promise.all([
        repositories.users.findById(customerId),
        repositories.appointments.listForCustomerAtBusiness(customerId, businessId),
      ]);
      if (user === null) throw notFound("Customer", customerId);

      return {
        user,
        appointments,
        lateCancellations: appointments.filter(
          (appointment) => appointment.lateCancellation,
        ).length,
        noShows: appointments.filter((appointment) => appointment.status === "NO_SHOW")
          .length,
      };
    });
  },
});

const loadCustomers = async (
  repositories: Parameters<typeof loadOwnedBusiness>[0],
  ids: readonly User["id"][],
): Promise<Map<User["id"], User>> => {
  const unique = [...new Set(ids)];
  const users = await Promise.all(unique.map((id) => repositories.users.findById(id)));
  return users.reduce((found, user) => {
    if (user !== null) found.set(user.id, user);
    return found;
  }, new Map<User["id"], User>());
};
