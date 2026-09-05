import {
  BUSINESS_DEFAULTS,
  cancelAppointment,
  money,
  subscriptionStateOn,
  todayIn,
  notFound,
  parseLocalDate,
  parseLocalTime,
  timeZone,
  validationFailed,
  type Business,
  type BusinessId,
  type BusinessPhoto,
  type BusinessPhotoId,
  type PhotoSlot,
  type DateOverride,
  type ResourceId,
  type Service,
  type ServiceId,
  type Clock,
  type Patch,
  type WorkingHours,
} from "@tor-now/domain";
import { PHOTOS } from "../config.ts";
import { notificationFor } from "./notifications.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import type { PhotoStore } from "../ports/photo-store.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { loadOwnedBusiness, loadOwnedResource, requireUser } from "./authorization.ts";

/**
 * Everything an owner does to their own Business. ADR 0011 makes registration
 * immediate — active is true from the first moment and there is no approval
 * queue — so this is also the whole of onboarding.
 */

export type RegistrationInput = {
  readonly name: string;
  readonly phone: string;
  readonly timeZone?: string | undefined;
  readonly description?: string | null | undefined;
  readonly address: string;
  readonly resourceNames: readonly string[];
  readonly services: readonly {
    name: string;
    durationMinutes: number;
    priceMinor: number;
    bufferMinutes: number | null;
  }[];
  readonly workingHours: readonly {
    dayOfWeek: number;
    start: string;
    end: string;
  }[];
};

/**
 * The object key a photo is stored under. Never guessed, always recorded.
 *
 * Random rather than timestamped: replacing a photo uploads the new bytes and
 * then drops the old ones by path, so two uploads that produced the same path
 * would end with the remove deleting the picture that had just replaced it. A
 * clock reading is not unique enough to be an identity, and this needs to be.
 */
const pathFor = (businessId: BusinessId, slot: PhotoSlot, contentType: string) =>
  `${businessId}/${slot}-${crypto.randomUUID()}.${EXTENSIONS[contentType] ?? "bin"}`;

const EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

export const businessService = ({
  unitOfWork,
  clock,
  photos,
}: {
  unitOfWork: UnitOfWork;
  clock: Clock;
  photos: PhotoStore;
}) => ({
  /**
   * Registration creates the Business, its owner Membership, at least one
   * Resource — every Business has one — and whatever the wizard collected, in a
   * single transaction. A half-registered Business is not a state the rest of
   * the system should have to handle.
   */
  async register(actor: Actor, input: RegistrationInput): Promise<Business> {
    const userId = requireUser(actor);
    if (input.resourceNames.length === 0) {
      throw validationFailed("A business needs at least one calendar");
    }

    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await repositories.businesses.create({
        name: input.name,
        phone: input.phone,
        timeZone: timeZone(input.timeZone ?? BUSINESS_DEFAULTS.timeZone),
        description: input.description ?? null,
        address: input.address,
      });

      await repositories.memberships.create(userId, business.id, "OWNER");

      const resources = await Promise.all(
        input.resourceNames.map((name) =>
          repositories.resources.create({ businessId: business.id, name }),
        ),
      );

      await Promise.all(
        input.services.map((service) =>
          repositories.services.create({
            businessId: business.id,
            name: service.name,
            durationMinutes: service.durationMinutes,
            price: money(service.priceMinor),
            bufferMinutes: service.bufferMinutes,
          }),
        ),
      );

      // The wizard collects one set of hours; they apply to every calendar the
      // business starts with, which an owner can then diverge per calendar.
      await Promise.all(
        resources.flatMap((resource) =>
          input.workingHours.map((hours) =>
            repositories.workingHours.create({
              resourceId: resource.id,
              businessId: business.id,
              dayOfWeek: hours.dayOfWeek,
              startMinutes: parseLocalTime(hours.start),
              endMinutes: parseLocalTime(hours.end),
            }),
          ),
        ),
      );

      return business;
    });
  },

  async update(
    actor: Actor,
    businessId: BusinessId,
    changes: Patch<{
      name: string;
      phone: string;
      timeZone: string;
      description: string | null;
      address: string | null;
      instagram: string | null;
      whatsapp: string | null;
      defaultBufferMinutes: number;
      minimumNoticeMinutes: number;
      bookingHorizonDays: number;
      cancellationWindowHours: number;
    }>,
  ): Promise<Business> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.businesses.update(businessId, {
        ...changes,
        ...(changes.timeZone === undefined
          ? {}
          : { timeZone: timeZone(changes.timeZone) }),
      });
    });
  },

  /**
   * What the Business owes the platform, for the owner's own eyes. Billing
   * concerns the operator and the owner and never the customer, who pays the
   * Business directly and outside the system entirely.
   *
   * Read-only here by design: only an administrator records a Payment or
   * changes a plan, which is why `subscription` has no write policy for an
   * owner and this method offers none.
   */
  async subscription(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      const [subscription, payments] = await Promise.all([
        repositories.subscriptions.findByBusiness(businessId),
        repositories.payments.listForBusiness(businessId),
      ]);
      if (subscription === null) throw notFound("Subscription", businessId);
      return {
        subscription,
        payments,
        state: subscriptionStateOn(
          subscription,
          todayIn(clock.now(), business.timeZone),
        ),
      };
    });
  },

  async listMine(actor: Actor): Promise<readonly Business[]> {
    const userId = requireUser(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const memberships = await repositories.memberships.listForUser(userId);
      const owned = memberships.filter((membership) => membership.role === "OWNER");
      const businesses = await Promise.all(
        owned.map((membership) => repositories.businesses.findById(membership.businessId)),
      );
      return businesses.filter((business): business is Business => business !== null);
    });
  },

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------

  async listServices(
    actor: Actor,
    businessId: BusinessId,
  ): Promise<readonly Service[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.services.listForBusiness(businessId, true);
    });
  },

  async createService(
    actor: Actor,
    businessId: BusinessId,
    input: {
      name: string;
      durationMinutes: number;
      priceMinor: number;
      bufferMinutes: number | null;
    },
  ): Promise<Service> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.services.create({
        businessId,
        name: input.name,
        durationMinutes: input.durationMinutes,
        price: money(input.priceMinor),
        bufferMinutes: input.bufferMinutes,
      });
    });
  },

  async updateService(
    actor: Actor,
    businessId: BusinessId,
    serviceId: ServiceId,
    changes: Patch<{
      name: string;
      durationMinutes: number;
      priceMinor: number;
      bufferMinutes: number | null;
      active: boolean;
    }>,
  ): Promise<Service> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const service = await repositories.services.findById(serviceId);
      if (service === null || service.businessId !== businessId) {
        throw notFound("Service", serviceId);
      }
      const { priceMinor, ...rest } = changes;
      return repositories.services.update(serviceId, {
        ...rest,
        ...(priceMinor === undefined ? {} : { price: money(priceMinor) }),
      });
    });
  },

  async deleteService(
    actor: Actor,
    businessId: BusinessId,
    serviceId: ServiceId,
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const service = await repositories.services.findById(serviceId);
      if (service === null || service.businessId !== businessId) {
        throw notFound("Service", serviceId);
      }
      await repositories.services.delete(serviceId);
    });
  },

  // -------------------------------------------------------------------------
  // Photos
  // -------------------------------------------------------------------------

  async listPhotos(
    actor: Actor,
    businessId: BusinessId,
  ): Promise<readonly BusinessPhoto[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.businessPhotos.listForBusiness(businessId);
    });
  },

  /**
   * Puts one photo in one slot, replacing whatever was there.
   *
   * Replacing rather than refusing is what the verb says, and it is also the
   * only safe way to do it: the alternative is the interface deleting the old
   * photo and then uploading the new one, which leaves the business with an
   * empty slot if the second call fails. Here the new bytes are stored first,
   * the swap is one transaction, and the old bytes are dropped only once
   * nothing refers to them any more.
   *
   * The bytes go up before the row for the same reason as ever: a row pointing
   * at nothing is a broken picture on a public page, while an object nobody
   * references is invisible and costs a few kilobytes.
   */
  async putPhoto(
    actor: Actor,
    businessId: BusinessId,
    input: {
      slot: PhotoSlot;
      bytes: Uint8Array;
      contentType: string;
    },
  ): Promise<BusinessPhoto> {
    if (!PHOTOS.allowedTypes.includes(input.contentType as never)) {
      throw validationFailed(
        `A photo must be one of ${PHOTOS.allowedTypes.join(", ")}`,
        { contentType: input.contentType },
      );
    }
    if (input.bytes.byteLength === 0) {
      throw validationFailed("A photo cannot be empty");
    }
    if (input.bytes.byteLength > PHOTOS.maximumBytes) {
      throw validationFailed(
        `A photo may be at most ${PHOTOS.maximumBytes} bytes`,
        { byteSize: input.bytes.byteLength },
      );
    }

    // Ownership is settled before anything is uploaded, so a stranger's bytes
    // never reach the bucket at all.
    await unitOfWork.run(actor, ({ repositories }) =>
      loadOwnedBusiness(repositories, actor, businessId),
    );

    const stored = await photos.put({
      path: pathFor(businessId, input.slot, input.contentType),
      bytes: input.bytes,
      contentType: input.contentType,
    });

    const swap = async () =>
      await unitOfWork.run(
        actor,
        async ({ repositories }) => {
          await loadOwnedBusiness(repositories, actor, businessId);
          const current =
            (await repositories.businessPhotos.listForBusiness(businessId)).find(
              (photo) => photo.slot === input.slot,
            ) ?? null;
          // Read and swapped inside one transaction, so two owners putting a
          // photo in the same slot at once cannot both keep theirs.
          if (current !== null) {
            await repositories.businessPhotos.delete(current.id);
          }
          return {
            written: await repositories.businessPhotos.create({
              businessId,
              slot: input.slot,
              storagePath: stored.path,
              contentType: input.contentType,
              byteSize: input.bytes.byteLength,
            }),
            replaced: current,
          };
        },
      );

    const { written, replaced } = await swap().catch(async (cause: unknown) => {
      // Nothing points at the bytes just uploaded, and whatever was in the slot
      // before is still there and still referenced.
      await photos.remove(stored.path);
      throw cause;
    });

    // Past this point the change has committed. Dropping the object the new
    // photo supersedes is tidying up, not part of the change, so a failure
    // here must not fail the call: the compensating delete above would take
    // away the bytes the committed row points at, leaving the business with a
    // photo that renders as nothing. An object left behind costs storage; that
    // is the smaller harm, and it is said out loud rather than swallowed.
    if (replaced !== null) {
      try {
        await photos.remove(replaced.storagePath);
      } catch (cause) {
        console.error("[photos] superseded object left behind", {
          path: replaced.storagePath,
          cause,
        });
      }
    }
    return written;
  },

  async deletePhoto(
    actor: Actor,
    businessId: BusinessId,
    photoId: BusinessPhotoId,
  ): Promise<void> {
    const removed = await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const photo = await repositories.businessPhotos.findById(photoId);
      if (photo === null || photo.businessId !== businessId) {
        throw notFound("BusinessPhoto", photoId);
      }
      await repositories.businessPhotos.delete(photoId);
      return photo;
    });
    // The row is gone, so nothing can render this object; dropping the bytes
    // after is a tidy-up rather than part of the change.
    await photos.remove(removed.storagePath);
  },

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  /**
   * The calendars, each with what is still booked on it.
   *
   * The count travels with the list because it is what the screen has to say
   * before asking the owner to decide: "this has three people booked on it" is
   * the whole of the question, and asking for it per calendar afterwards would
   * be a request per row for a number the list already knows how to fetch.
   */
  async listResourcesWithUpcoming(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const [resources, counts] = [
        await repositories.resources.listForBusiness(businessId),
        await repositories.appointments.upcomingCountsByResource(businessId, clock.now()),
      ];
      return resources.map((resource) => ({
        resource,
        upcoming: counts.get(resource.id) ?? 0,
      }));
    });
  },

  async listResources(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.resources.listForBusiness(businessId);
    });
  },

  /**
   * A new calendar opens on the same week the business already keeps.
   *
   * Hours hang off a Resource rather than the Business (ADR 0002), which is
   * what lets one person work Sundays and another not. The cost was that a new
   * calendar arrived with no hours at all — bookable at no time, and unusable
   * until the owner typed out a week the business had already described. So it
   * starts as a copy of an existing calendar's week and is edited from there,
   * which is the common case: a second chair keeps the shop's hours.
   */
  async createResource(actor: Actor, businessId: BusinessId, name: string) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const existing = await repositories.resources.listForBusiness(businessId);
      const created = await repositories.resources.create({ businessId, name });

      // The oldest calendar still on offer is the business's own week as far as
      // anything here can tell. Nothing to copy is not a failure: the first
      // calendar of all is made by registration, which sets its hours itself.
      const source = existing.find((resource) => resource.active) ?? existing[0];
      if (source !== undefined) {
        const week = await repositories.workingHours.listForResource(source.id);
        for (const hours of week) {
          await repositories.workingHours.create({
            resourceId: created.id,
            businessId,
            dayOfWeek: hours.dayOfWeek,
            startMinutes: hours.start,
            endMinutes: hours.end,
          });
        }
      }
      return created;
    });
  },

  async updateResource(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    changes: Patch<{ name: string; active: boolean }>,
  ) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      // Hiding is how a calendar stops being offered, so hiding the last one
      // leaves a Business nobody can book — the same end deleteResource already
      // refuses, reached by a different door.
      if (changes.active === false) {
        const stillOffered = (
          await repositories.resources.listForBusiness(businessId)
        ).filter((resource) => resource.active && resource.id !== resourceId);
        if (stillOffered.length === 0) {
          throw validationFailed("A business must keep at least one calendar");
        }
      }
      return repositories.resources.update(resourceId, changes);
    });
  },

  /**
   * Taking a calendar away, and saying what becomes of what is booked on it.
   *
   * Past appointments are never in question: they are the record of what
   * happened and the repository keeps them by withdrawing rather than deleting.
   * The ones still to come are a real choice the owner has to make, because
   * both answers are wrong by default — cancelling silently strands people who
   * are expecting to be seen, and keeping silently leaves appointments on a
   * calendar the owner believes is gone. So the caller says which, and the
   * screen asks.
   */
  async deleteResource(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    upcoming: "KEEP" | "CANCEL" = "KEEP",
  ) {
    await unitOfWork.run(actor, async (session) => {
      const { repositories } = session;
      const business = await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      // Every Business has at least one Resource; removing the last one would
      // leave it unbookable with no way to say so. Counted among the ones still
      // on offer: a withdrawn calendar keeps its row, so counting rows would
      // let the last bookable one go as long as a retired one sat behind it.
      const stillOffered = (
        await repositories.resources.listForBusiness(businessId)
      ).filter((resource) => resource.active);
      if (stillOffered.length <= 1) {
        throw validationFailed("A business must keep at least one calendar");
      }

      if (upcoming === "CANCEL") {
        // Cancelled by the Business, and each customer told: someone holding an
        // appointment that is about to stop existing has to hear it from us
        // rather than discover it at the door.
        const booked = await repositories.appointments.upcomingForResource(
          resourceId,
          clock.now(),
        );
        for (const appointment of booked) {
          const outcome = cancelAppointment(
            appointment,
            business,
            "BUSINESS",
            clock.now(),
          );
          const cancelled = await repositories.appointments.update(appointment.id, {
            status: "CANCELLED",
            ...outcome,
          });
          const customer = await repositories.users.findById(appointment.customerId);
          if (customer !== null) {
            await session.outbox.enqueue(
              notificationFor(TEMPLATES.bookingCancelled, cancelled, business, customer),
            );
          }
        }
      }

      await repositories.resources.delete(resourceId);
    });
  },

  // -------------------------------------------------------------------------
  // The schedule layers (ADR 0002)
  // -------------------------------------------------------------------------

  async listWorkingHours(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
  ): Promise<readonly WorkingHours[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      return repositories.workingHours.listForResource(resourceId);
    });
  },

  async addWorkingHours(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    input: { dayOfWeek: number; start: string; end: string },
  ): Promise<WorkingHours> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      const start = parseLocalTime(input.start);
      const end = parseLocalTime(input.end);
      if (end <= start) {
        throw validationFailed("A range must end after it starts");
      }
      return repositories.workingHours.create({
        resourceId,
        businessId,
        dayOfWeek: input.dayOfWeek,
        startMinutes: start,
        endMinutes: end,
      });
    });
  },

  async updateWorkingHours(
    actor: Actor,
    businessId: BusinessId,
    id: WorkingHours["id"],
    input: { start: string; end: string },
  ): Promise<WorkingHours> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const start = parseLocalTime(input.start);
      const end = parseLocalTime(input.end);
      if (end <= start) throw validationFailed("A range must end after it starts");
      return repositories.workingHours.update(id, {
        startMinutes: start,
        endMinutes: end,
      });
    });
  },

  async deleteWorkingHours(
    actor: Actor,
    businessId: BusinessId,
    id: WorkingHours["id"],
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await repositories.workingHours.delete(id);
    });
  },

  async listOverrides(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    from: string,
    to: string,
  ): Promise<readonly DateOverride[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      return repositories.dateOverrides.listForResource(
        resourceId,
        parseLocalDate(from),
        parseLocalDate(to),
      );
    });
  },

  /**
   * ADR 0002: an Override replaces the weekday's rules entirely, so this writes
   * the whole date at once. An empty range list is a day off, not a no-op.
   */
  async putOverride(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    input: {
      date: string;
      note: string | null;
      ranges: readonly { start: string; end: string }[];
    },
  ): Promise<DateOverride> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      return repositories.dateOverrides.put({
        resourceId,
        businessId,
        date: parseLocalDate(input.date),
        note: input.note,
        ranges: input.ranges.map((range) => {
          const start = parseLocalTime(range.start);
          const end = parseLocalTime(range.end);
          if (end <= start) throw validationFailed("A range must end after it starts");
          return { startMinutes: start, endMinutes: end };
        }),
      });
    });
  },

  async deleteOverride(
    actor: Actor,
    businessId: BusinessId,
    id: DateOverride["id"],
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await repositories.dateOverrides.delete(id);
    });
  },
});
