import {
  BUSINESS_DEFAULTS,
  cancelAppointment,
  DomainError,
  forbidden,
  isStaff,
  manages,
  mergedRanges,
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
  type Membership,
  type MembershipId,
  type MembershipRole,
  type ResourceId,
  type Service,
  type ServiceId,
  type Clock,
  type Patch,
  type User,
  type WorkingHours,
} from "@tor-now/domain";
import { PHOTOS } from "../config.ts";
import { notificationFor } from "./notifications.ts";
import { TEMPLATES } from "../ports/notifier.ts";
import type { PhotoStore } from "../ports/photo-store.ts";
import type { Repositories } from "../ports/repositories.ts";
import { actorUserId, type Actor, type UnitOfWork } from "../ports/unit-of-work.ts";
import {
  loadOwnedBusiness,
  loadOwnedResource,
  requireOwnerOrManager,
  requireResourceAccess,
  requireStaff,
  requireUser,
} from "./authorization.ts";

/**
 * Everything an owner does to their own Business. ADR 0011 makes registration
 * immediate — active is true from the first moment and there is no approval
 * queue — so this is also the whole of onboarding.
 */

/**
 * A Business someone works at and the terms they work there on. `resourceIds` is
 * null for OWNER and MANAGER, who reach every calendar — an empty list would
 * read as "assigned to none", which is a different thing.
 */
export type StaffedBusiness = {
  readonly business: Business;
  readonly role: MembershipRole;
  readonly resourceIds: readonly ResourceId[] | null;
};

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

/**
 * The stretches of one day, checked the way the domain would store them: each
 * ending after it starts, and no two of them running together. Two that collide
 * describe one stretch, and a caller that has not said which is asking the
 * store to guess.
 */
const rangesThatDoNotCollide = (
  ranges: readonly { start: string; end: string }[],
): readonly { start: string; end: string }[] => {
  for (const range of ranges) {
    if (parseLocalTime(range.end) <= parseLocalTime(range.start)) {
      throw validationFailed("A range must end after it starts");
    }
  }
  if (mergedRanges(ranges).length !== ranges.length) {
    throw validationFailed("A day's ranges must not overlap one another");
  }
  return ranges;
};

/** The roles that work at a Business. A customer is a member, not a team member. */
export type TeamRole = Exclude<MembershipRole, "CUSTOMER">;

/**
 * Someone on the team as the people running the Business see them: the person,
 * the terms, and the calendars. `resourceIds` is empty for OWNER and MANAGER,
 * who reach every calendar without a row saying so.
 */
export type TeamMember = {
  readonly user: User;
  readonly membership: Membership;
  readonly resourceIds: readonly ResourceId[];
};

export type InviteInput = {
  readonly phone: string;
  readonly givenName: string;
  readonly familyName?: string | null | undefined;
  readonly role: TeamRole;
  readonly resourceIds?: readonly ResourceId[] | undefined;
};

const assignedResources = async (
  repositories: Repositories,
  membership: Membership,
): Promise<readonly ResourceId[]> => {
  if (membership.role !== "WORKER") return [];
  const assignments = await repositories.membershipResources.listForMembership(
    membership.id,
  );
  return assignments.map((assignment) => assignment.resourceId);
};

/**
 * Only a WORKER has calendars listed, and they must have at least one: a WORKER
 * assigned to nothing can see nothing, which looks like a broken account rather
 * than a restricted one.
 */
const resourcesFor = (
  role: TeamRole,
  resourceIds: readonly ResourceId[] | undefined,
): readonly ResourceId[] => {
  if (role !== "WORKER") {
    if (resourceIds !== undefined && resourceIds.length > 0) {
      throw validationFailed("Only a worker is assigned to particular resources");
    }
    return [];
  }
  const wanted = [...new Set(resourceIds ?? [])];
  if (wanted.length === 0) {
    throw validationFailed("A worker needs at least one resource");
  }
  return wanted;
};

/** ADR 0016 keeps one thing from a MANAGER: an OWNER, in either direction. */
const requireRoleWithinReach = (
  actorMembership: Membership | null,
  role: MembershipRole,
): void => {
  if (actorMembership === null || actorMembership.role === "OWNER") return;
  if (role === "OWNER") {
    throw forbidden("Only an owner can add, change or remove another owner");
  }
};

/** A MANAGER/OWNER (or administrator) sees every calendar; a WORKER only theirs. */
const visibleResources = async (
  repositories: Repositories,
  membership: Membership | null,
  businessId: BusinessId,
) => {
  const resources = await repositories.resources.listForBusiness(businessId);
  if (membership === null || manages(membership)) return resources;

  const assignments = await repositories.membershipResources.listForMembership(
    membership.id,
  );
  const assigned = new Set(assignments.map((assignment) => assignment.resourceId));
  return resources.filter((resource) => assigned.has(resource.id));
};

const loadTeamMembership = async (
  repositories: Repositories,
  businessId: BusinessId,
  membershipId: MembershipId,
): Promise<Membership> => {
  const membership = await repositories.memberships.findById(membershipId);
  if (membership === null || membership.businessId !== businessId || !isStaff(membership)) {
    throw notFound("Membership", membershipId);
  }
  return membership;
};

/** A Business without an OWNER has nobody who can pay for it or close it. */
const requireAnotherOwner = async (
  repositories: Repositories,
  businessId: BusinessId,
  besides: MembershipId,
): Promise<void> => {
  const owners = await repositories.memberships.listForBusiness(businessId, "OWNER");
  if (!owners.some((owner) => owner.id !== besides)) {
    throw new DomainError(
      "CONFLICT",
      "A business needs an owner. Make somebody else an owner first.",
    );
  }
};

/**
 * The assignments a WORKER should have, made to match. Written as a diff rather
 * than delete-then-insert so an unchanged row keeps its identity, and so the
 * audit log records what actually changed (ADR 0006).
 */
const setAssignments = async (
  repositories: Repositories,
  businessId: BusinessId,
  membership: Membership,
  resourceIds: readonly ResourceId[],
): Promise<void> => {
  const existing = await repositories.membershipResources.listForMembership(
    membership.id,
  );
  for (const assignment of existing) {
    if (!resourceIds.includes(assignment.resourceId)) {
      await repositories.membershipResources.delete(assignment.id);
    }
  }
  for (const resourceId of resourceIds) {
    if (existing.some((assignment) => assignment.resourceId === resourceId)) continue;
    // Proves the Resource is this Business's before the row claims both.
    await loadOwnedResource(repositories, businessId, resourceId);
    await repositories.membershipResources.create({
      membershipId: membership.id,
      businessId,
      resourceId,
    });
  }
};

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
      await requireOwnerOrManager(repositories, actor, businessId);
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

  /**
   * The businesses this person works at, with the role they hold at each — the
   * screen behind `/manage` decides which tabs exist from it, so a WORKER also
   * arrives with the calendars they were assigned. OWNER and MANAGER reach every
   * calendar and carry no list.
   */
  async listMine(actor: Actor): Promise<readonly StaffedBusiness[]> {
    const userId = requireUser(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const memberships = await repositories.memberships.listForUser(userId);
      const staffed = memberships.filter(isStaff);
      const entries = await Promise.all(
        staffed.map(async (membership): Promise<StaffedBusiness | null> => {
          const business = await repositories.businesses.findById(membership.businessId);
          if (business === null) return null;
          if (membership.role !== "WORKER") {
            return { business, role: membership.role, resourceIds: null };
          }
          const assignments = await repositories.membershipResources.listForMembership(
            membership.id,
          );
          return {
            business,
            role: membership.role,
            resourceIds: assignments.map((assignment) => assignment.resourceId),
          };
        }),
      );
      return entries.filter((entry): entry is StaffedBusiness => entry !== null);
    });
  },

  // -------------------------------------------------------------------------
  // The team (ADR 0016)
  // -------------------------------------------------------------------------

  /**
   * Who works here. Customers are members too, so the list is the staff ones —
   * the customers tab is a different screen answering a different question.
   */
  async listUsers(
    actor: Actor,
    businessId: BusinessId,
  ): Promise<readonly TeamMember[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await requireOwnerOrManager(repositories, actor, businessId);
      const memberships = (
        await repositories.memberships.listAllForBusiness(businessId)
      ).filter(isStaff);
      const members = await Promise.all(
        memberships.map(async (membership): Promise<TeamMember | null> => {
          const user = await repositories.users.findById(membership.userId);
          if (user === null) return null;
          return {
            user,
            membership,
            resourceIds: await assignedResources(repositories, membership),
          };
        }),
      );
      return members.filter((member): member is TeamMember => member !== null);
    });
  },

  /**
   * Whether a phone number already belongs to someone, so the invite sheet can
   * show their name instead of asking the owner/manager to type it blind. A
   * closed account reads as not-found, matching how `inviteUser` treats one.
   */
  async lookupUserByPhone(
    actor: Actor,
    businessId: BusinessId,
    phone: string,
  ): Promise<{ exists: false } | { exists: true; givenName: string; familyName: string | null }> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await requireOwnerOrManager(repositories, actor, businessId);
      const user = await repositories.users.findByPhone(phone);
      if (user === null || user.deletedAt != null) return { exists: false };
      return { exists: true, givenName: user.givenName, familyName: user.familyName };
    });
  },

  /**
   * Adding someone by their phone number, which is the only thing about them the
   * person inviting reliably knows.
   *
   * There is no pending-invite table: the Membership is real from this moment,
   * against a User row created now if that number has never signed in. When it
   * does sign in, `verifyCode` finds that row by phone and treats the number as
   * known — the invitation is already waiting rather than being redeemed.
   *
   * Re-inviting somebody who is already here changes their terms rather than
   * failing, because that is what the person clicking meant.
   */
  async inviteUser(
    actor: Actor,
    businessId: BusinessId,
    input: InviteInput,
  ): Promise<TeamMember> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const invitedBy = await requireOwnerOrManager(repositories, actor, businessId);
      requireRoleWithinReach(invitedBy, input.role);
      const resourceIds = resourcesFor(input.role, input.resourceIds);

      const existing = await repositories.users.findByPhone(input.phone);
      if (existing?.deletedAt != null) {
        throw validationFailed("That number belongs to a closed account");
      }

      const held =
        existing === null
          ? null
          : await repositories.memberships.find(existing.id, businessId);
      if (held !== null) requireRoleWithinReach(invitedBy, held.role);

      const { user, membership } = await repositories.memberships.invite(businessId, {
        phone: input.phone,
        givenName: input.givenName,
        familyName: input.familyName ?? null,
        role: input.role,
      });

      await setAssignments(repositories, businessId, membership, resourceIds);
      return {
        user,
        membership,
        resourceIds: await assignedResources(repositories, membership),
      };
    });
  },

  /**
   * Changing someone's terms: their role, the calendars they work, or both.
   *
   * Omitting `resourceIds` for a WORKER leaves their calendars alone, but
   * becoming a WORKER has to name at least one — a WORKER with no calendar can
   * see nothing, which is an account that looks broken rather than restricted.
   */
  async updateUser(
    actor: Actor,
    businessId: BusinessId,
    membershipId: MembershipId,
    changes: {
      readonly role?: MembershipRole | undefined;
      readonly resourceIds?: readonly ResourceId[] | undefined;
    },
  ): Promise<TeamMember> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const changedBy = await requireOwnerOrManager(repositories, actor, businessId);
      const held = await loadTeamMembership(repositories, businessId, membershipId);
      requireRoleWithinReach(changedBy, held.role);

      const role = changes.role ?? held.role;
      requireRoleWithinReach(changedBy, role);
      if (held.role === "OWNER" && role !== "OWNER") {
        await requireAnotherOwner(repositories, businessId, held.id);
      }

      const membership =
        role === held.role
          ? held
          : await repositories.memberships.setRole(held.id, role);

      if (role !== "WORKER") {
        await setAssignments(repositories, businessId, membership, []);
      } else if (changes.resourceIds !== undefined || held.role !== "WORKER") {
        await setAssignments(
          repositories,
          businessId,
          membership,
          resourcesFor(role, changes.resourceIds),
        );
      }

      const user = await repositories.users.findById(membership.userId);
      if (user === null) throw notFound("User", membership.userId);
      return {
        user,
        membership,
        resourceIds: await assignedResources(repositories, membership),
      };
    });
  },

  /**
   * Taking someone off the team. Their Membership goes and its assignments go
   * with it; the User stays, because they may be a customer somewhere else and
   * their past appointments here are the record of what happened.
   */
  async removeUser(
    actor: Actor,
    businessId: BusinessId,
    membershipId: MembershipId,
  ): Promise<void> {
    await unitOfWork.run(actor, async ({ repositories }) => {
      const removedBy = await requireOwnerOrManager(repositories, actor, businessId);
      const held = await loadTeamMembership(repositories, businessId, membershipId);
      requireRoleWithinReach(removedBy, held.role);
      if (held.role === "OWNER") {
        await requireAnotherOwner(repositories, businessId, held.id);
      }
      if (held.userId === actorUserId(actor)) {
        throw forbidden("Cannot remove yourself from the team");
      }
      await repositories.memberships.delete(held.id);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      requireOwnerOrManager(repositories, actor, businessId),
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
          await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      const membership = await requireStaff(repositories, actor, businessId);
      const [resources, counts] = [
        await visibleResources(repositories, membership, businessId),
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
      const membership = await requireStaff(repositories, actor, businessId);
      return visibleResources(repositories, membership, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireOwnerOrManager(repositories, actor, businessId);
      const business = await repositories.businesses.findById(businessId);
      if (business === null) throw notFound("Business", businessId);
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
      await requireResourceAccess(repositories, actor, businessId, resourceId);
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
      await requireResourceAccess(repositories, actor, businessId, resourceId);
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

  /**
   * The calendar's whole week at once, replacing what was there.
   *
   * The screen edits a week and then saved it as a delete per existing range
   * and a create per new one — fifteen sequential requests across the Atlantic
   * for one tap, which is what made saving take seconds. One call, one
   * transaction, one audit row.
   */
  async replaceWorkingHours(
    actor: Actor,
    businessId: BusinessId,
    resourceId: ResourceId,
    week: readonly { dayOfWeek: number; start: string; end: string }[],
  ): Promise<readonly WorkingHours[]> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await requireResourceAccess(repositories, actor, businessId, resourceId);
      await loadOwnedResource(repositories, businessId, resourceId);
      const ranges = week.map((range) => {
        const start = parseLocalTime(range.start);
        const end = parseLocalTime(range.end);
        if (end <= start) throw validationFailed("A range must end after it starts");
        return { dayOfWeek: range.dayOfWeek, startMinutes: start, endMinutes: end };
      });

      // Two stretches of one day that run together describe one stretch, and
      // the caller is expected to have said so. Refusing them here rather than
      // storing them is what turns a caller's mistake into an answer: a week
      // arriving with a day written twice used to be accepted, and the day it
      // belonged to quietly lost its hours.
      for (const dayOfWeek of new Set(ranges.map((range) => range.dayOfWeek))) {
        const onThisDay = ranges.filter((range) => range.dayOfWeek === dayOfWeek);
        const asClock = (minutes: number) =>
          `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
            minutes % 60,
          ).padStart(2, "0")}`;
        const stretches = onThisDay.map((range) => ({
          start: asClock(range.startMinutes),
          end: asClock(range.endMinutes),
        }));
        if (mergedRanges(stretches).length !== stretches.length) {
          throw validationFailed("A day's ranges must not overlap one another", {
            dayOfWeek,
          });
        }
      }

      return repositories.workingHours.replaceForResource(resourceId, businessId, ranges);
    });
  },

  async updateWorkingHours(
    actor: Actor,
    businessId: BusinessId,
    id: WorkingHours["id"],
    input: { start: string; end: string },
  ): Promise<WorkingHours> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      // ponytail: manager-and-up rather than per-calendar. A range is addressed
      // by its own id here and neither hours nor overrides can be read back by
      // id, so there is nothing to resolve to a Resource without adding a
      // `findById` to two ports. The week editor saves through
      // `replaceWorkingHours`, which is resource-scoped and gated as such; add
      // the port methods if a WORKER ever needs these two routes.
      await requireOwnerOrManager(repositories, actor, businessId);
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
      // ponytail: manager-and-up, for the reason `updateWorkingHours` gives.
      await requireOwnerOrManager(repositories, actor, businessId);
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
      await requireResourceAccess(repositories, actor, businessId, resourceId);
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
      await requireResourceAccess(repositories, actor, businessId, resourceId);
      await loadOwnedResource(repositories, businessId, resourceId);
      return repositories.dateOverrides.put({
        resourceId,
        businessId,
        date: parseLocalDate(input.date),
        note: input.note,
        ranges: rangesThatDoNotCollide(input.ranges).map((range) => {
          const start = parseLocalTime(range.start);
          const end = parseLocalTime(range.end);
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
      // ponytail: manager-and-up, for the reason `updateWorkingHours` gives.
      await requireOwnerOrManager(repositories, actor, businessId);
      await repositories.dateOverrides.delete(id);
    });
  },
});
