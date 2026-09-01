import {
  BUSINESS_DEFAULTS,
  freeSlots,
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
  readonly address?: string | null | undefined;
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

/** The object key a photo is stored under. Never guessed, always recorded. */
const pathFor = (businessId: BusinessId, slot: PhotoSlot, contentType: string) =>
  `${businessId}/${slot}-${Date.now()}.${EXTENSIONS[contentType] ?? "bin"}`;

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
        address: input.address ?? null,
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
   * Adds one photo to one slot.
   *
   * The bytes go to the store first and the row second, because the opposite
   * order can leave a row pointing at nothing — a broken picture on a public
   * page. This order can leave an object with no row, which is invisible and
   * costs a few kilobytes; of the two failures it is plainly the better one.
   */
  async addPhoto(
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

    // Ownership and the free slot are read before anything is uploaded, so a
    // stranger's bytes never reach the bucket at all.
    const free = await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const existing =
        await repositories.businessPhotos.listForBusiness(businessId);
      return freeSlots(existing.map((photo) => photo.slot));
    });
    if (!free.includes(input.slot)) {
      throw validationFailed("That photo slot is already taken", {
        slot: input.slot,
      });
    }

    const stored = await photos.put({
      path: pathFor(businessId, input.slot, input.contentType),
      bytes: input.bytes,
      contentType: input.contentType,
    });

    try {
      return await unitOfWork.run(actor, async ({ repositories }) => {
        await loadOwnedBusiness(repositories, actor, businessId);
        return repositories.businessPhotos.create({
          businessId,
          slot: input.slot,
          storagePath: stored.path,
          contentType: input.contentType,
          byteSize: input.bytes.byteLength,
        });
      });
    } catch (cause) {
      // The slot was free a moment ago and is not now, or the write failed for
      // any other reason. Either way nothing points at these bytes.
      await photos.remove(stored.path);
      throw cause;
    }
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

  async listResources(actor: Actor, businessId: BusinessId) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.resources.listForBusiness(businessId);
    });
  },

  async createResource(actor: Actor, businessId: BusinessId, name: string) {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return repositories.resources.create({ businessId, name });
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
      return repositories.resources.update(resourceId, changes);
    });
  },

  async deleteResource(actor: Actor, businessId: BusinessId, resourceId: ResourceId) {
    await unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await loadOwnedResource(repositories, businessId, resourceId);
      const remaining = await repositories.resources.listForBusiness(businessId);
      // Every Business has at least one Resource; removing the last one would
      // leave it unbookable with no way to say so.
      if (remaining.length <= 1) {
        throw validationFailed("A business must keep at least one calendar");
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
