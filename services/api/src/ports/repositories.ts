import type {
  Patch,
  Appointment,
  AppointmentId,
  Block,
  BlockedSpan,
  BlockId,
  Business,
  BusinessId,
  BusinessPhoto,
  BusinessPhotoId,
  DateOverride,
  DateOverrideId,
  Instant,
  LocalDate,
  Membership,
  MembershipId,
  MembershipResource,
  MembershipResourceId,
  MembershipRole,
  Money,
  OccupiedSpan,
  PartOfDay,
  Payment,
  PhotoSlot,
  Resource,
  ResourceId,
  Service,
  ServiceId,
  Subscription,
  TimeZone,
  User,
  UserId,
  WaitingEntryId,
  WorkingHours,
  WorkingHoursId,
  BusinessCategory,
  Review,
} from "@tor-now/domain";

/**
 * The interfaces the application layer speaks through. Every one of them is
 * implemented twice: once against Postgres, and once in memory for the tests.
 *
 * ADR 0006 makes keeping all writes behind these a standing constraint, not a
 * preference — the auditing decorator wraps repositories, so a write that
 * reaches the database another way produces no audit trail.
 */

export type Page = { readonly limit: number; readonly offset: number };

/**
 * One day of a month overview. Cancelled appointments are not counted: the
 * number is meant to answer "how busy is this day", and a called-off booking
 * is not.
 */
export type DayCount = {
  readonly date: LocalDate;
  readonly count: number;
};

/**
 * One day of one calendar's month overview.
 *
 * The plural reads answer for several calendars at once, so the row has to say
 * whose day it is — a flat list the caller groups, rather than a shape the port
 * has to know how to nest.
 */
export type ResourceDayCount = DayCount & { readonly resourceId: ResourceId };

/** How many rows were created in a month, for a signup trend. */
export type MonthCount = {
  readonly monthStart: LocalDate;
  readonly count: number;
};

/** One week's appointments, by how each one ended. */
export type WeeklyAppointmentActivity = {
  readonly weekStart: LocalDate;
  readonly confirmed: number;
  readonly cancelled: number;
  readonly noShow: number;
  readonly completed: number;
};

/** One Business's share of platform-wide appointment volume. */
export type BusinessVolume = {
  readonly businessId: BusinessId;
  readonly businessName: string;
  readonly count: number;
};

export type UserRepository = {
  findById(id: UserId): Promise<User | null>;
  /**
   * The same question asked about many people at once, for the screens that
   * name the customer on every row — a day's appointments, a business's
   * customer list. One per id is one round trip per id, and a transaction holds
   * a single connection, so the list of names cost as much as the list itself.
   *
   * Ids nothing answers for are absent rather than null, and the order is the
   * database's: callers index the result by id.
   */
  findByIds(ids: readonly UserId[]): Promise<readonly User[]>;
  findByPhone(phone: string): Promise<User | null>;
  create(user: {
    phone: string;
    givenName: string;
    familyName: string | null;
    birthDate: LocalDate | null;
  }): Promise<User>;
  update(
    id: UserId,
    changes: Patch<Pick<User, "givenName" | "familyName" | "birthDate">>,
  ): Promise<User>;
  /** ADR 0008: marks the row deleted and hides it; personal data is retained. */
  softDelete(id: UserId): Promise<User>;
  restore(id: UserId): Promise<User>;
  /**
   * ADR 0008: answers a formal erasure request. Clears everything identifying
   * and keeps the row, so nothing that refers to it is orphaned. Irreversible,
   * and never undone by `restore`.
   */
  anonymise(id: UserId): Promise<User>;
  setAdministrator(id: UserId, isAdministrator: boolean): Promise<User>;
  list(page: Page, query: string | null): Promise<readonly User[]>;
  /** Platform-wide signups by month, for the administrator's statistics tab. */
  monthlySignups(from: Instant, to: Instant): Promise<readonly MonthCount[]>;
  /** Platform-wide total, for the administrator's statistics tab. */
  count(): Promise<number>;
};

export type BusinessSearchResult = {
  readonly business: Business;
  readonly score: number;
};

/** ADR 0017: what a search asks for. Empty `text` with a `category` is a browse. */
export type BusinessSearchCriteria = {
  readonly text: string;
  /** Chosen by the customer: a hard filter. */
  readonly category: BusinessCategory | null;
  /** Inferred from `text`: a ranking boost that also admits a non-matching name. */
  readonly inferred: readonly BusinessCategory[];
  /** Orders equal scores nearest first — which, for a browse, is all of them. */
  readonly near: { readonly latitude: number; readonly longitude: number } | null;
};

export type BusinessRepository = {
  findById(id: BusinessId): Promise<Business | null>;
  /** ADR 0011: trigram similarity with a boost for prefix matches; ADR 0017: and Category. */
  search(criteria: BusinessSearchCriteria): Promise<readonly BusinessSearchResult[]>;
  create(business: {
    name: string;
    phone: string;
    timeZone: string;
    description: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    category: BusinessCategory | null;
  }): Promise<Business>;
  update(
    id: BusinessId,
    changes: Patch<Omit<Business, "id" | "timeZone"> & { timeZone: string }>,
  ): Promise<Business>;
  setActive(id: BusinessId, active: boolean): Promise<Business>;
  list(page: Page, query: string | null): Promise<readonly Business[]>;
  /** Platform-wide registrations by month, for the administrator's statistics tab. */
  monthlySignups(from: Instant, to: Instant): Promise<readonly MonthCount[]>;
};

export type BusinessPhotoRepository = {
  listForBusiness(businessId: BusinessId): Promise<readonly BusinessPhoto[]>;
  findById(id: BusinessPhotoId): Promise<BusinessPhoto | null>;
  /**
   * Claims one slot. The database refuses a second row in the same slot, which
   * is what makes "one cover, at most three others" true of the data rather
   * than of whichever code path happens to be writing.
   */
  create(photo: {
    businessId: BusinessId;
    slot: PhotoSlot;
    storagePath: string;
    contentType: string;
    byteSize: number;
  }): Promise<BusinessPhoto>;
  delete(id: BusinessPhotoId): Promise<void>;
};

export type ReviewRepository = {
  /** Newest first, each with its author's given name unless it is anonymous. */
  listForBusiness(businessId: BusinessId): Promise<readonly Review[]>;
  /** The customer's own, author included even when anonymous. */
  findFor(businessId: BusinessId, customerId: UserId): Promise<Review | null>;
  /**
   * The customer's one review of this Business: written the first time, edited
   * every time after. The unique pair makes a second one impossible.
   */
  put(review: {
    businessId: BusinessId;
    customerId: UserId;
    stars: number;
    comment: string;
    anonymous: boolean;
  }): Promise<Review>;
};

export type MembershipRepository = {
  find(userId: UserId, businessId: BusinessId): Promise<Membership | null>;
  listForUser(userId: UserId): Promise<readonly Membership[]>;
  listForBusiness(
    businessId: BusinessId,
    role: MembershipRole,
  ): Promise<readonly Membership[]>;
  create(
    userId: UserId,
    businessId: BusinessId,
    role: MembershipRole,
  ): Promise<Membership>;
  /** Creates a customer Membership only if one does not already exist. */
  ensureCustomer(userId: UserId, businessId: BusinessId): Promise<Membership>;
  /** Blocks or unblocks a customer at one Business. */
  setBlocked(
    userId: UserId,
    businessId: BusinessId,
    blockedAt: Instant | null,
  ): Promise<Membership>;
  findById(id: MembershipId): Promise<Membership | null>;
  /** Every Membership at one Business, whatever the role. */
  listAllForBusiness(businessId: BusinessId): Promise<readonly Membership[]>;
  setRole(id: MembershipId, role: MembershipRole): Promise<Membership>;
  delete(id: MembershipId): Promise<void>;
  /**
   * Finds or creates the User by phone, then creates or updates their
   * Membership at this Business — atomically, bypassing app_user's RLS gap
   * for a not-yet-registered invitee (ADR 0016).
   */
  /**
   * Finds or creates the User by phone, then makes sure they hold a Membership
   * at this Business — adding a CUSTOMER one if there is none, and leaving any
   * existing one exactly as it is.
   *
   * Separate from `invite` because the permission differs: handing somebody a
   * role is management's, while writing down who an appointment is for is
   * anybody's who works here. It also must not rewrite a role, which `invite`
   * does on purpose.
   */
  addCustomer(
    businessId: BusinessId,
    input: { phone: string; givenName: string; familyName: string | null },
  ): Promise<{ user: User; membership: Membership }>;
  invite(
    businessId: BusinessId,
    input: {
      phone: string;
      givenName: string;
      familyName: string | null;
      role: MembershipRole;
      /** What the owner actually typed, kept as a display hint — see Membership. */
      invitedGivenName: string | null;
      invitedFamilyName: string | null;
    },
  ): Promise<{ user: User; membership: Membership }>;
};

/**
 * Which Resources a WORKER may see. OWNER and MANAGER are never listed: they
 * reach every Resource in their Business implicitly.
 */
export type MembershipResourceRepository = {
  listForMembership(
    membershipId: MembershipId,
  ): Promise<readonly MembershipResource[]>;
  listForResource(
    resourceId: ResourceId,
  ): Promise<readonly MembershipResource[]>;
  create(assignment: {
    membershipId: MembershipId;
    businessId: BusinessId;
    resourceId: ResourceId;
  }): Promise<MembershipResource>;
  delete(id: MembershipResourceId): Promise<void>;
};

export type ResourceRepository = {
  findById(id: ResourceId): Promise<Resource | null>;
  listForBusiness(businessId: BusinessId): Promise<readonly Resource[]>;
  create(resource: {
    businessId: BusinessId;
    name: string;
  }): Promise<Resource>;
  update(
    id: ResourceId,
    changes: Patch<Pick<Resource, "name" | "active">>,
  ): Promise<Resource>;
  delete(id: ResourceId): Promise<void>;
};

export type ServiceRepository = {
  findById(id: ServiceId): Promise<Service | null>;
  listForBusiness(
    businessId: BusinessId,
    includeInactive: boolean,
  ): Promise<readonly Service[]>;
  create(service: {
    businessId: BusinessId;
    name: string;
    durationMinutes: number;
    price: Money;
    bufferMinutes: number | null;
  }): Promise<Service>;
  update(
    id: ServiceId,
    changes: Patch<Omit<Service, "id" | "businessId">>,
  ): Promise<Service>;
  delete(id: ServiceId): Promise<void>;
};

export type WorkingHoursRepository = {
  listForResource(resourceId: ResourceId): Promise<readonly WorkingHours[]>;
  /**
   * The weeks of several calendars at once, flat, each row naming its own.
   *
   * A screen that draws every calendar side by side asked this once per
   * calendar, and a transaction holds one connection — so a shop with six
   * chairs paid six round trips for what is one question with six answers.
   */
  listForResources(
    resourceIds: readonly ResourceId[],
  ): Promise<readonly WorkingHours[]>;
  create(hours: {
    resourceId: ResourceId;
    businessId: BusinessId;
    dayOfWeek: number;
    startMinutes: number;
    endMinutes: number;
  }): Promise<WorkingHours>;
  update(
    id: WorkingHoursId,
    changes: { startMinutes: number; endMinutes: number },
  ): Promise<WorkingHours>;
  delete(id: WorkingHoursId): Promise<void>;
  /**
   * This calendar's whole week, in place of the week it had.
   *
   * The editor speaks in days and the store speaks in ranges, with no
   * correspondence between the two to preserve — a day that lost its break has
   * one range where it had two. Saving it as a delete and an insert per range
   * meant fifteen round trips for one tap of "save"; this is one.
   */
  replaceForResource(
    resourceId: ResourceId,
    businessId: BusinessId,
    ranges: readonly { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
  ): Promise<readonly WorkingHours[]>;
};

export type DateOverrideRepository = {
  listForResource(
    resourceId: ResourceId,
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly DateOverride[]>;
  /** As `listForResource`, for several calendars at once. See `listForResources` on working hours. */
  listForResources(
    resourceIds: readonly ResourceId[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly DateOverride[]>;
  findByDate(
    resourceId: ResourceId,
    date: LocalDate,
  ): Promise<DateOverride | null>;
  /**
   * Replaces the whole override for a date, ranges included. ADR 0002 makes an
   * Override a replacement rather than an addition, so writing one is a single
   * atomic act rather than a set of range edits.
   */
  put(override: {
    resourceId: ResourceId;
    businessId: BusinessId;
    date: LocalDate;
    note: string | null;
    ranges: readonly { startMinutes: number; endMinutes: number }[];
  }): Promise<DateOverride>;
  /**
   * Returns the calendar and date the removed Override stood on, or null when
   * nothing matched. ADR 0018: removing one restores the weekday's Working
   * Hours, so the caller has to mark that date — and the id is all it has.
   */
  delete(
    id: DateOverrideId,
  ): Promise<{ resourceId: ResourceId; date: LocalDate } | null>;
};

export type BlockRepository = {
  findById(id: BlockId): Promise<Block | null>;
  /** The interval only; the reason is the owner's business. */
  blockedBetween(
    resourceId: ResourceId,
    from: Instant,
    to: Instant,
  ): Promise<readonly BlockedSpan[]>;
  listForResourceBetween(
    resourceId: ResourceId,
    from: Instant,
    to: Instant,
  ): Promise<readonly Block[]>;
  /** As `listForResourceBetween`, for several calendars at once. */
  listForResourcesBetween(
    resourceIds: readonly ResourceId[],
    from: Instant,
    to: Instant,
  ): Promise<readonly Block[]>;
  /** As the appointment repository counts, for the same grid. */
  countsByLocalDay(
    resourceId: ResourceId,
    from: Instant,
    to: Instant,
    timeZone: TimeZone,
  ): Promise<readonly DayCount[]>;
  create(block: {
    resourceId: ResourceId;
    businessId: BusinessId;
    startAt: Instant;
    endAt: Instant;
    reason: string;
    groupId: string;
  }): Promise<Block>;
  delete(id: BlockId): Promise<void>;
  /**
   * Everything one decision created. A holiday is given back the way it was
   * taken — in one go — and doing it row by row is how half a holiday ends up
   * still blocking a diary.
   */
  deleteGroup(businessId: BusinessId, groupId: string): Promise<number>;
  /**
   * What one decision is called, changed for all of it at once.
   *
   * A holiday's reason belongs to the holiday, not to each of its days: renaming
   * Monday and leaving Tuesday saying something else describes a decision that
   * was never made. Answers how many it renamed.
   */
  renameGroup(businessId: BusinessId, groupId: string, reason: string): Promise<number>;
  /** The blocks of one group, so a screen can say what removing it would take. */
  listGroup(businessId: BusinessId, groupId: string): Promise<readonly Block[]>;
};

export type AppointmentDraft = Omit<
  Appointment,
  | "id"
  | "cancelledAt"
  | "cancelledBy"
  | "lateCancellation"
  // Set by the reminder job, never by whoever is making the booking.
  | "reminderEnqueuedAt"
  | "createdAt"
>;

/** An appointment with the person who booked it, for a screen that lists both. */
export type BookedAppointment = {
  readonly appointment: Appointment;
  readonly customerName: string;
  readonly customerPhone: string;
};

/** A customer's own appointment, with the business and staff named for display (e.g. "add to calendar"). */
export type AppointmentWithBusiness = {
  readonly appointment: Appointment;
  readonly businessName: string;
  readonly resourceName: string;
};

/**
 * The same, plus where the business is — its own free-text address and the pin
 * the owner dropped, so a customer's own list can say how far away it is.
 *
 * Its own type rather than three more optional fields on the one above: the
 * clash check and the reminder name a business, they do not place it, and a
 * field that one query fills and two leave undefined is a contract nobody can
 * read off the signature.
 */
export type AppointmentWithBusinessPlace = AppointmentWithBusiness & {
  readonly businessCategory: BusinessCategory | null;
  readonly businessAddress: string | null;
  readonly businessLatitude: number | null;
  readonly businessLongitude: number | null;
};

/** An appointment and everyone a reminder about it needs to name. */
export type AppointmentToRemind = {
  readonly appointment: Appointment;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly businessName: string;
  readonly businessPhone: string;
  readonly businessTimeZone: string;
};

export type AppointmentRepository = {
  findById(id: AppointmentId): Promise<Appointment | null>;
  /**
   * When the Resource is busy, and nothing more. Availability uses this rather
   * than reading Appointments, because RLS shows a customer only their own —
   * whole rows would be either too little to be correct or more than anyone
   * outside the business is entitled to see.
   */
  occupiedBetween(
    resourceId: ResourceId,
    from: Instant,
    to: Instant,
  ): Promise<readonly OccupiedSpan[]>;
  listForResourceBetween(
    resourceId: ResourceId,
    from: Instant,
    to: Instant,
  ): Promise<readonly Appointment[]>;
  /** As `listForResourceBetween`, for several calendars at once. */
  listForResourcesBetween(
    resourceIds: readonly ResourceId[],
    from: Instant,
    to: Instant,
  ): Promise<readonly Appointment[]>;
  /**
   * How many appointments fall on each day of a span, counted in the Business's
   * own zone rather than the server's.
   *
   * A month overview wants one number per day and nothing else. Reading the
   * appointments themselves to count them would fetch a month of rows and then
   * hydrate a customer for each of them, which is a page of work to draw a
   * grid of numbers.
   */
  countsByLocalDay(
    resourceId: ResourceId,
    from: Instant,
    to: Instant,
    timeZone: TimeZone,
  ): Promise<readonly DayCount[]>;
  /** As `countsByLocalDay`, for several calendars at once, each row naming its own. */
  countsByLocalDayForResources(
    resourceIds: readonly ResourceId[],
    from: Instant,
    to: Instant,
    timeZone: TimeZone,
  ): Promise<readonly ResourceDayCount[]>;
  /**
   * Appointments still to come at this Business whose customer matches a
   * search, soonest first.
   *
   * A customer rings up about an appointment; the owner knows who is calling
   * and not when it is. Without this the only way to it is to guess a date, or
   * to page forward until it appears — which for something two months out is a
   * search conducted by scrolling.
   */
  searchUpcoming(
    businessId: BusinessId,
    query: string,
    from: Instant,
    limit: number,
  ): Promise<readonly BookedAppointment[]>;
  listForBusinessBetween(
    businessId: BusinessId,
    from: Instant,
    to: Instant,
  ): Promise<readonly Appointment[]>;
  listForCustomer(
    customerId: UserId,
    page: Page,
  ): Promise<readonly Appointment[]>;
  /** As listForCustomer, with the business name attached for a customer-facing screen. */
  listForCustomerWithBusiness(
    customerId: UserId,
    page: Page,
  ): Promise<readonly AppointmentWithBusinessPlace[]>;
  listForCustomerAtBusiness(
    customerId: UserId,
    businessId: BusinessId,
  ): Promise<readonly Appointment[]>;
  /**
   * The customer's confirmed appointment for this Service inside the window, if
   * they have one — the appointment rather than a yes, because what the screen
   * has to say is "you already have this, with Ran, at nine", and a boolean
   * cannot say any of it. Any calendar counts: the same haircut twice in a day
   * is the same question wherever it was booked.
   */
  confirmedForServiceBetween(
    customerId: UserId,
    serviceId: ServiceId,
    from: Instant,
    to: Instant,
  ): Promise<Appointment | null>;
  /**
   * The customer's own confirmed appointment running across this span, wherever
   * it was booked, with the business named — a person cannot be in two chairs
   * at once, and the clash a Business cannot see is precisely the one at
   * somebody else's. Half-open: an appointment that ends exactly where the next
   * begins does not overlap it.
   */
  overlappingForCustomer(
    customerId: UserId,
    from: Instant,
    to: Instant,
  ): Promise<AppointmentWithBusiness | null>;
  /**
   * Everyone who has ever booked here, whatever else they are to this Business.
   *
   * The customer list used to be read off the CUSTOMER membership, but a person
   * holds one role per Business and booking deliberately never demotes an
   * owner — so an owner who takes an appointment in their own chair was absent
   * from their own customer list. Booking is what makes the relationship
   * (CONTEXT.md), so booking is what this asks about.
   */
  customerIdsFor(businessId: BusinessId): Promise<readonly UserId[]>;
  /**
   * Appointments still to come on this calendar. Asked before a calendar is
   * taken away, because "this has four people booked on it" is the thing an
   * owner needs to know before answering, and asked again while doing it, since
   * what is cancelled has to be exactly what was described.
   */
  upcomingForResource(
    resourceId: ResourceId,
    from: Instant,
  ): Promise<readonly Appointment[]>;
  /**
   * How many appointments are still to come on each of a Business's calendars.
   *
   * One statement for the whole list rather than one per calendar: the list is
   * reloaded after every change to a calendar, and asking per row put a round
   * trip to Postgres between the owner and their own screen for each one.
   */
  upcomingCountsByResource(
    businessId: BusinessId,
    from: Instant,
  ): Promise<ReadonlyMap<ResourceId, number>>;
  /**
   * Confirmed appointments starting inside the window that have not had a
   * reminder written yet (ADR 0005). Returned with the customer attached,
   * because a reminder is addressed to a person.
   */
  dueForReminder(
    from: Instant,
    to: Instant,
    limit: number,
  ): Promise<readonly AppointmentToRemind[]>;
  /** Stamped in the same transaction as the outbox row, so it happens once. */
  markReminderEnqueued(ids: readonly AppointmentId[]): Promise<void>;
  /**
   * Throws a `SLOT_TAKEN` DomainError when ADR 0003's exclusion constraint
   * refuses the insert. Translating it here means no caller has to know that
   * the rule lives in the database.
   */
  create(draft: AppointmentDraft): Promise<Appointment>;
  update(
    id: AppointmentId,
    changes: Patch<
      Pick<
        Appointment,
        | "status"
        | "startAt"
        | "endAt"
        | "occupiedUntil"
        | "cancelledAt"
        | "cancelledBy"
        | "lateCancellation"
        | "customerNote"
      >
    >,
  ): Promise<Appointment>;
  /**
   * Platform-wide booking volume by week, broken down by how each appointment
   * ended — the administrator's statistics tab, and nothing more specific: no
   * customer or resource crosses this boundary, only counts.
   */
  platformWeeklyActivity(
    from: Instant,
    to: Instant,
  ): Promise<readonly WeeklyAppointmentActivity[]>;
  /** The busiest Businesses in a span, cancelled appointments excluded. */
  topBusinessesByVolume(
    from: Instant,
    to: Instant,
    limit: number,
  ): Promise<readonly BusinessVolume[]>;
};

export type SubscriptionRepository = {
  findByBusiness(businessId: BusinessId): Promise<Subscription | null>;
  update(
    businessId: BusinessId,
    changes: Patch<Omit<Subscription, "id" | "businessId">>,
  ): Promise<Subscription>;
  /** Every Subscription whose grace period has elapsed, for the deactivation job. */
  listLapsed(today: LocalDate): Promise<readonly Subscription[]>;
};

export type PaymentRepository = {
  create(payment: {
    subscriptionId: Subscription["id"];
    businessId: BusinessId;
    amount: Money;
    paidOn: LocalDate;
    recordedBy: UserId;
    note: string | null;
  }): Promise<Payment>;
  listForBusiness(businessId: BusinessId): Promise<readonly Payment[]>;
};

export type AdministratorAllowlistRepository = {
  contains(phone: string): Promise<boolean>;
  list(): Promise<readonly { phone: string; note: string | null }[]>;
  add(phone: string, note: string | null, addedBy: UserId): Promise<void>;
  remove(phone: string): Promise<void>;
};


/**
 * A Waiting Entry: a customer's standing request to be told when a Resource
 * has time for one Service on one date, in the parts of the day they chose.
 *
 * It holds no time. ADR 0018 — a Slot is computed on demand and never stored,
 * so what is kept here is the question, and the answer is recomputed by the
 * ordinary availability code.
 */
export type WaitingEntry = {
  readonly id: WaitingEntryId;
  readonly businessId: BusinessId;
  readonly customerId: UserId;
  readonly serviceId: ServiceId;
  /** One, several, or all of the Business's calendars. Never empty. */
  readonly resourceIds: readonly ResourceId[];
  readonly onDate: LocalDate;
  /** Never empty; wanting all three is what "any time" means. */
  readonly parts: readonly PartOfDay[];
  readonly lastNotifiedAt: Instant | null;
  readonly closedAt: Instant | null;
};

/**
 * An entry the job is about to consider, with everything a message needs
 * already attached — as a reminder carries its customer, and for the same
 * reason: the alternative is a round trip per waiting person.
 */
export type WaitingEntryToTell = {
  readonly entry: WaitingEntry;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly serviceName: string;
  readonly businessName: string;
  readonly businessPhone: string;
  readonly businessTimeZone: string;
};

export type WaitingEntryRepository = {
  /**
   * The entry this customer has open for this Service on this date, written or
   * rewritten.
   *
   * Asking twice is the same ask — so a second tap is not an error, and
   * changing one's mind about which hours suit replaces the question rather
   * than raising a second one. The unique index says the same thing in the
   * database; upserting means no caller has to recover from it, and nothing
   * has to survive an aborted transaction to do so.
   */
  put(draft: {
    businessId: BusinessId;
    customerId: UserId;
    serviceId: ServiceId;
    resourceIds: readonly ResourceId[];
    onDate: LocalDate;
    parts: readonly PartOfDay[];
  }): Promise<WaitingEntry>;
  findById(id: WaitingEntryId): Promise<WaitingEntry | null>;
  /** What a customer is still waiting for, soonest first. */
  openForCustomer(
    customerId: UserId,
    from: LocalDate,
  ): Promise<readonly WaitingEntry[]>;
  /**
   * Everyone still waiting on this calendar and date, ready to be told.
   *
   * `notifiedBefore` keeps one entry from becoming a stream of messages on a
   * day that frees up repeatedly: an entry told about an opening recently is
   * passed over, exactly as ADR 0013's stamp keeps a reminder to one.
   */
  toTell(
    resourceId: ResourceId,
    onDate: LocalDate,
    notifiedBefore: Instant,
  ): Promise<readonly WaitingEntryToTell[]>;
  /** Stamped in the same transaction as the outbox rows, so it happens once. */
  markNotified(ids: readonly WaitingEntryId[], at: Instant): Promise<void>;
  close(ids: readonly WaitingEntryId[], at: Instant): Promise<void>;
  /**
   * Close whatever this customer was waiting for, now that they have booked
   * it. Nobody should be told about an opening for a time they already hold.
   */
  closeForBooking(
    customerId: UserId,
    businessId: BusinessId,
    serviceId: ServiceId,
    onDate: LocalDate,
    at: Instant,
  ): Promise<void>;
};

/** A calendar date whose availability changed and has not been re-examined. */
export type WaitingRecheck = {
  readonly resourceId: ResourceId;
  readonly onDate: LocalDate;
};

export type WaitingRecheckRepository = {
  /**
   * Leave a mark, in the same transaction as whatever changed. Marking a date
   * twice is one mark: the work is "look at this day", however many edits
   * asked for it.
   */
  mark(resourceId: ResourceId, onDate: LocalDate): Promise<void>;
  /** Oldest first, so a busy morning cannot starve an earlier change. */
  oldest(limit: number): Promise<readonly WaitingRecheck[]>;
  clear(marks: readonly WaitingRecheck[]): Promise<void>;
};

export type Repositories = {
  readonly users: UserRepository;
  readonly businesses: BusinessRepository;
  readonly businessPhotos: BusinessPhotoRepository;
  readonly reviews: ReviewRepository;
  readonly memberships: MembershipRepository;
  readonly membershipResources: MembershipResourceRepository;
  readonly resources: ResourceRepository;
  readonly services: ServiceRepository;
  readonly workingHours: WorkingHoursRepository;
  readonly dateOverrides: DateOverrideRepository;
  readonly blocks: BlockRepository;
  readonly appointments: AppointmentRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly payments: PaymentRepository;
  readonly administratorAllowlist: AdministratorAllowlistRepository;
  readonly waitingEntries: WaitingEntryRepository;
  readonly waitingRechecks: WaitingRecheckRepository;
};
