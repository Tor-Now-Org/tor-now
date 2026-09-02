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
  MembershipRole,
  Money,
  OccupiedSpan,
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
  WorkingHours,
  WorkingHoursId,
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

export type UserRepository = {
  findById(id: UserId): Promise<User | null>;
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
};

export type BusinessSearchResult = {
  readonly business: Business;
  readonly score: number;
};

export type BusinessRepository = {
  findById(id: BusinessId): Promise<Business | null>;
  /** ADR 0011: trigram similarity with a boost for prefix matches. */
  search(query: string): Promise<readonly BusinessSearchResult[]>;
  create(business: {
    name: string;
    phone: string;
    timeZone: string;
    description: string | null;
    address: string | null;
  }): Promise<Business>;
  update(
    id: BusinessId,
    changes: Patch<Omit<Business, "id" | "timeZone"> & { timeZone: string }>,
  ): Promise<Business>;
  setActive(id: BusinessId, active: boolean): Promise<Business>;
  list(page: Page, query: string | null): Promise<readonly Business[]>;
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
};

export type DateOverrideRepository = {
  listForResource(
    resourceId: ResourceId,
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
  delete(id: DateOverrideId): Promise<void>;
};

export type BlockRepository = {
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
  }): Promise<Block>;
  delete(id: BlockId): Promise<void>;
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
  listForCustomerAtBusiness(
    customerId: UserId,
    businessId: BusinessId,
  ): Promise<readonly Appointment[]>;
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
      >
    >,
  ): Promise<Appointment>;
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

export type Repositories = {
  readonly users: UserRepository;
  readonly businesses: BusinessRepository;
  readonly businessPhotos: BusinessPhotoRepository;
  readonly memberships: MembershipRepository;
  readonly resources: ResourceRepository;
  readonly services: ServiceRepository;
  readonly workingHours: WorkingHoursRepository;
  readonly dateOverrides: DateOverrideRepository;
  readonly blocks: BlockRepository;
  readonly appointments: AppointmentRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly payments: PaymentRepository;
  readonly administratorAllowlist: AdministratorAllowlistRepository;
};
