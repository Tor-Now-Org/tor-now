import type { BusinessCategory, NoticeFacts, NoticeTone } from "@tor-now/domain";

/**
 * The wire shapes, mirroring services/api/src/http/wire.ts. Kept as a hand
 * written mirror rather than generated: the API is the contract, and a change
 * to it should be a visible edit here rather than a silent regeneration.
 */

export type BusinessDto = {
  id: string;
  name: string;
  phone: string;
  timeZone: string;
  description: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** ADR 0017. Absent from an older API, null for a business that has not chosen one. */
  category?: BusinessCategory | null;
  /**
   * Instagram handle, bare: no @ and no URL. Optional in the type as well as
   * in the data — an API deployed before these existed sends neither key, and
   * a screen that reads them has to survive that.
   */
  instagram?: string | null;
  /** The number this business answers WhatsApp on, which may differ from phone. */
  whatsapp?: string | null;
  active: boolean;
  defaultBufferMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  cancellationWindowHours: number;
  /**
   * The terms the person asking works here under, on the businesses list only.
   * Optional in the type as well as the data — an API deployed before roles
   * existed sends neither key, and the manage screen has to survive that by
   * treating the absence as the old world, where anybody staffing was an OWNER.
   */
  role?: "OWNER" | "MANAGER" | "WORKER" | "CUSTOMER";
  /** The calendars a WORKER is on. Empty for an OWNER or MANAGER, who reach all of them. */
  resourceIds?: string[];
  /**
   * What the Business's plan lets its staff do (ADR 0019), on the businesses
   * list only. Absent from an API that predates plans: read as "everything",
   * so nothing is locked by a deploy that has not caught up.
   */
  entitlement?: EntitlementDto;
  /**
   * Whether some active Resource is open right now, in the Business's own
   * timezone. Search results only — every other endpoint that returns a
   * BusinessDto has no use for it and never sends it.
   */
  openNow?: boolean;
};

export type FeatureName =
  | "REMINDERS"
  | "CUSTOMER_HISTORY"
  | "CUSTOMER_BLOCKING"
  | "TEAM_ROLES"
  | "WAITING_LIST";

export type EntitlementDto = {
  features: FeatureName[];
  resourceAllowance: number;
};

export type ServiceDto = {
  id: string;
  businessId: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
  price: number;
  bufferMinutes: number | null;
  active: boolean;
};

export type ResourceDto = {
  id: string;
  businessId: string;
  name: string;
  active: boolean;
  /**
   * How many appointments are still to come on this calendar. Optional: an API
   * deployed before the count sends nothing, and the screen must not read that
   * as "none booked" when it is about to ask what to do with them.
   */
  upcomingAppointments?: number;
  /**
   * Taken out of booking because the Business holds more calendars than its
   * plan allows. Still the owner's, still carrying its appointments. Absent
   * from an older API, which never paused anything.
   */
  paused?: boolean;
  /** The day it pauses, when its owner scheduled a move to a smaller Plan. */
  pausesOn?: string | null;
};

export type BusinessProfileDto = {
  business: BusinessDto;
  services: ServiceDto[];
  resources: ResourceDto[];
  /**
   * The cover first, then the rest, in slot order.
   *
   * Optional because the interface and the API are deployed separately, and for
   * the minutes between the two a browser running the new page can be talking
   * to the old function. A field this page has never seen before is absent
   * then, and a page that assumes otherwise goes blank for everybody.
   */
  photos?: BusinessPhotoDto[];
  /** Present when the request asked for a date range. */
  availability?: DayAvailabilityDto[];
  /**
   * Whether a customer may ask to hear about a freed time here. Absent from an
   * older API, where every Business had the waiting list.
   */
  waitingList?: boolean;
};

/** One square of the owner's month grid. */
export type MonthDayDto = {
  date: string;
  /** Appointments that still stand; a cancelled one is not counted. */
  appointments: number;
  blocks: number;
};

/** One day, every calendar: lanes, the hours behind them, and what fills them. */
export type BusinessDayDto = {
  date: string;
  calendars: {
    resourceId: string;
    resourceName: string;
    open: { start: string; end: string }[];
    special: boolean;
    /** Why the day is special, when the owner said. */
    note: string | null;
    appointments: CalendarAppointmentDto[];
    blocks: BlockDto[];
  }[];
};

/** The whole business's month: every calendar, and the decisions spanning days. */
export type BusinessMonthDto = {
  days: {
    date: string;
    byCalendar: {
      resourceId: string;
      /** Whether this calendar works that day. Absent from an older API. */
      works?: boolean;
      appointments: number;
      away: boolean;
    }[];
    /**
     * Whether anybody works that day at all, by the week's own shape.
     *
     * Optional, like every other field added after a deploy: the interface
     * ships ahead of the API often enough that "absent" has to mean something
     * safe. Absent means open — reading it as closed drew every day of every
     * month as a day nobody works.
     */
    shopOpen?: boolean;
    shopClosed: boolean;
    shopHours: { start: string; end: string }[];
    /** Why the shop is doing that, when it was given a reason. */
    shopNote: string | null;
  }[];
  blockages: {
    groupId: string;
    resourceId: string;
    reason: string;
    fromDate: string;
    toDate: string;
    days: number;
    allDay: boolean;
  }[];
  /** Runs of shut days, so a week away is drawn as a week away. */
  closures: ClosureBandDto[];
};

export type ClosureBandDto = {
  fromDate: string;
  toDate: string;
  days: number;
  note: string | null;
  /** Shut altogether, or open on hours of its own. */
  kind: "SHUT" | "HOURS";
  /** The hours kept. Empty for a day that is shut. */
  hours: { start: string; end: string }[];
};

/** What closing a run of days would call off, before anything is written. */
export type ClosureImpactDto = {
  days: number;
  calendars: number;
  appointments: {
    id: string;
    startAt: string;
    resourceName: string;
    serviceName: string;
    customerName: string;
    customerPhone: string;
  }[];
};

export type ClosureOutcomeDto = {
  days: number;
  calendars: number;
  cancelled: number;
};

export type SlotDto = { startAt: string; endAt: string };

/** ADR 0012: why a day is empty decides what the interface offers instead. */
export type EmptyReason =
  | "CLOSED"
  | "FULLY_BOOKED"
  | "TOO_SOON"
  | "BEYOND_HORIZON";

export type DayAvailabilityDto = {
  date: string;
  slots: SlotDto[];
  emptyReason: EmptyReason | null;
};

export type AppointmentStatus =
  | "CONFIRMED"
  | "CANCELLED"
  | "NO_SHOW"
  | "COMPLETED";

export type AppointmentDto = {
  id: string;
  businessId: string;
  resourceId: string;
  serviceId: string;
  customerId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  serviceName: string;
  /**
   * Who it is with, as the calendar was named at booking time. Optional in the
   * type: an API deployed before this field sends nothing, and a screen that
   * reads it has to survive that.
   */
  resourceName?: string;
  priceMinor: number;
  price: number;
  durationMinutes: number;
  customerNote: string | null;
  cancelledAt: string | null;
  cancelledBy: "CUSTOMER" | "BUSINESS" | null;
  lateCancellation: boolean;
  createdAt: string;
};

/** ADR 0018. The coarse parts a day is read in, as the slot grid groups it. */
export type PartOfDayName = "MORNING" | "NOON" | "EVENING";

/**
 * What a customer is still waiting for. It holds no time — a date, the parts
 * of it that suit, and the calendars it will accept.
 */
export type WaitingDto = {
  id: string;
  businessId: string;
  businessName: string;
  serviceId: string;
  serviceName: string;
  resourceNames: string[];
  onDate: string;
  parts: PartOfDayName[];
};

export type MyAppointmentDto = AppointmentDto & {
  businessName: string;
  businessCategory: BusinessCategory | null;
  resourceName: string;
  /** Where the business is: as the owner typed it, and as they pinned it. */
  businessAddress: string | null;
  businessLatitude: number | null;
  businessLongitude: number | null;
};

export type CalendarAppointmentDto = AppointmentDto & {
  customerName: string;
  customerPhone: string;
};

/** One picture of a business. Slot 0 is the cover; 1-3 are the rest. */
export type ReviewDto = {
  id: string;
  stars: number;
  comment: string;
  anonymous: boolean;
  /** Null when anonymous. */
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BusinessReviewsDto = {
  reviews: ReviewDto[];
  /** The caller's own, when signed in and written. */
  mine: ReviewDto | null;
  /** A confirmed appointment here is what allows writing one. */
  mayReview: boolean;
};

export type BusinessPhotoDto = {
  id: string;
  slot: 0 | 1 | 2 | 3;
  /** Absolute with Storage behind the deployment, relative to the API without. */
  url: string;
  contentType: string;
  byteSize: number;
};

export type UserDto = {
  id: string;
  phone: string;
  givenName: string;
  familyName: string | null;
  /** The two joined, as the API renders them. Display only. */
  name: string;
  birthDate: string | null;
  isAdministrator: boolean;
  deleted: boolean;
  /** ADR 0008: a formal erasure was answered. Not the same as deleted. */
  anonymised: boolean;
  createdAt: string;
};

/**
 * The signed-in person, as only they are told about themselves: whether they
 * work anywhere, which is what decides the invitation to open a business.
 */
export type MeDto = UserDto & {
  isHasBusinesses: boolean;
};

export type WorkingHoursDto = {
  id: string;
  resourceId: string;
  dayOfWeek: number;
  start: string;
  end: string;
};

export type OverrideDto = {
  id: string;
  resourceId: string;
  date: string;
  note: string | null;
  ranges: { start: string; end: string }[];
  closed: boolean;
};

export type BlockDto = {
  id: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  reason: string;
  /**
   * What one decision created. Blocks made together share it, so a week away is
   * shown and removed as one thing. Optional in the type: an API deployed
   * before blockages could span days sends nothing. Every block the current
   * API answers with has one — a blockage of a single day is a group of one.
   */
  groupId?: string | null;
};

export type CalendarDayDto = {
  date: string;
  appointments: CalendarAppointmentDto[];
  blocks: BlockDto[];
};

/** A User as one Business sees them: the person, plus their standing there. */
export type CustomerDto = UserDto & { blocked: boolean };

/** A colleague: the person, the terms, and the calendars they are on. */
export type TeamMemberDto = UserDto & {
  membershipId: string;
  role: "OWNER" | "MANAGER" | "WORKER" | "CUSTOMER";
  resourceIds: string[];
  joinedAt: string;
  pending: boolean;
};

export type CustomerRecordDto = {
  user: UserDto;
  /** Blocked from booking at this Business. Per-business, like the record itself. */
  blocked: boolean;
  /**
   * Whether blocking is even a question here. False for an owner who booked at
   * their own business: they reach this page through the customer list, but
   * hold the OWNER role and cannot be barred from their own chair.
   */
  blockable?: boolean;
  appointments: AppointmentDto[];
  /**
   * False when the plan does not include Customer History: `appointments` is
   * then only what is still to come, and the counts are null. Absent from an
   * older API, which always sent the whole history.
   */
  historyIncluded?: boolean;
  lateCancellations: number | null;
  noShows: number | null;
};

export type PlanName = "SOLO" | "TEAM";

/** A Subscription with the Plan Version it is on, flattened as the API sends it. */
export type SubscriptionDto = {
  id: string;
  businessId: string;
  plan: PlanName;
  planVersion: number;
  priceMinor: number;
  price: number;
  resourceAllowance: number;
  features: string[];
  trialEndsOn: string | null;
  paidThrough: string | null;
  scheduledMove: { plan: PlanName; planVersion: number; effectiveOn: string } | null;
};

/** A Feature on every Plan for now, until its Preview ends. */
export type PreviewDto = { feature: FeatureName; endsOn: string };

/** The Catalogue as anyone may read it: the Plans, and what is in Preview. */
export type CatalogueDto = { plans: PlanDto[]; previews: PreviewDto[] };

/** One Plan as the Catalogue offers it to new Businesses today. */
export type PlanDto = {
  plan: PlanName;
  planVersion: number;
  priceMinor: number;
  price: number;
  resourceAllowance: number;
  features: string[];
};

/** Where a Business stands: exactly one of these at a time (packages/domain billing/standing.ts). */
export type BillingStatus = "TRIAL" | "PAID" | "IN_GRACE" | "LAPSED" | "DEACTIVATED";
export const BILLING_STATUSES: readonly BillingStatus[] = ["TRIAL", "PAID", "IN_GRACE", "LAPSED", "DEACTIVATED"];

/** Beside the status, anything asking for a look. */
export type BillingFlag = "TRIAL_ENDING" | "MOVE_PENDING" | "OVER_ALLOWANCE";
export const BILLING_FLAGS: readonly BillingFlag[] = ["TRIAL_ENDING", "MOVE_PENDING", "OVER_ALLOWANCE"];

export type Standing = {
  status: BillingStatus;
  /** The date the status turns on; its meaning depends on the status. */
  nextDate: string | null;
  flags: BillingFlag[];
};

/** The owner's and the administrator's billing panel. */
export type BillingDto = Standing & {
  subscription: SubscriptionDto;
  payments: PaymentDto[];
  /** Every Feature and where the Business has it from. Absent from an older API. */
  features?: FeatureSourceDto[];
};

export type FeatureSourceKind = "PLAN" | "GRANT" | "PREVIEW" | "NONE";

/**
 * One Feature and where a Business has it from (ADR 0021). The Grant's details
 * reach an administrator only; an owner's list says the day and nothing more.
 */
export type FeatureSourceDto = {
  feature: FeatureName;
  source: FeatureSourceKind;
  endsOn: string | null;
  grant: { id: string; reason: string; grantedBy: string | null; grantedAt: string } | null;
};

/** One edition of a Plan, as the Catalogue editor shows it (ADR 0020). */
export type PlanEditionDto = {
  id: string;
  plan: PlanName;
  number: number;
  priceMinor: number;
  resourceAllowance: number;
  features: FeatureName[];
  publishedAt: string;
  /** The first day an existing Business moves onto it; null when nobody had to. */
  firstMoveOn: string | null;
};

export type BusinessRefDto = { id: string; name: string };

/** A new edition waiting for existing Businesses to move onto it. */
export type PendingChangeDto = {
  edition: PlanEditionDto;
  previous: PlanEditionDto;
  moving: { business: BusinessRefDto; effectiveOn: string }[];
  joined: BusinessRefDto[];
  cancellable: boolean;
};

export type PlanViewDto = {
  plan: PlanName;
  current: PlanEditionDto;
  /** Every edition anybody is on, and the current one, newest first. */
  editions: (PlanEditionDto & { current: boolean; businesses: number })[];
  pending: PendingChangeDto | null;
  /** When existing Businesses would move, were a change that takes value published today. */
  ifTakenToday: { firstMoveOn: string; lastMoveOn: string; businesses: number } | null;
};

export type PlanCatalogueDto = {
  plans: PlanViewDto[];
  previews: { feature: FeatureName; endsOn: string }[];
};

export type PlanChangeKind = "NONE" | "GIVES" | "TAKES";

/** One Feature as the Features tab shows it (ADR 0020). */
export type FeatureViewDto = {
  feature: FeatureName;
  plans: { plan: PlanName; number: number; included: boolean }[];
  /** The running Preview of it: when it ends, and which Plans keep it (null while undecided). */
  preview: { endsOn: string; keepOn: PlanName[] | null; decidedAt: string | null } | null;
  counts: { PLAN: number; GRANT: number; PREVIEW: number };
  canPreview: boolean;
};

export type CostUnitName = "WHATSAPP_UTILITY" | "WHATSAPP_AUTHENTICATION" | "SMS_SEGMENT";

/** What one unit of messaging cost from a day, and the evidence (ADR 0022). */
export type UnitRateDto = {
  unit: CostUnitName;
  effectiveFrom: string;
  microShekels: number;
  source: string;
  /** Null for a default the platform shipped with, nobody has checked. */
  checkedBy: string | null;
  enteredAt: string;
};

/**
 * One Notice (ADR 0020) as the API sends it: what happened, as facts the web
 * words in the owner's own language, and whether its banner still stands.
 */
export type NoticeDto = {
  id: string;
  kind: NoticeFacts["kind"];
  tone: NoticeTone;
  facts: NoticeFacts;
  createdAt: string;
  read: boolean;
  standing: boolean;
};

/** The owner's Notices, newest first, and the one banner to show. */
export type NoticeBoardDto = {
  notices: NoticeDto[];
  banner: { noticeId: string; othersUnread: number } | null;
};

export type PaymentDto = {
  id: string;
  businessId: string;
  amountMinor: number;
  amount: number;
  paidOn: string;
  note: string | null;
  recordedAt: string;
};

/** One line of the administrator's Businesses tab. */
export type DirectoryRowDto = Standing & {
  business: BusinessDto;
  ownerName: string | null;
  ownerPhone: string | null;
  plan: PlanName;
  planVersion: number;
  /** How many Features it has by Grant, beyond its Plan. Absent from an older API. */
  granted?: number;
};

/** Where a Feature comes from, as the directory filter asks it. */
export type FeatureFrom = "ANY" | "PLAN" | "GRANT" | "PREVIEW";

export type DirectoryFilter = {
  query: string;
  statuses: BillingStatus[];
  plan: PlanName | null;
  /** One edition of a Plan, by its id. */
  edition: string | null;
  flags: BillingFlag[];
  /** A Feature the Business has, and from where. */
  feature: FeatureName | null;
  featureSource: FeatureFrom;
};

export const NO_DIRECTORY_FILTER: DirectoryFilter = {
  query: "",
  statuses: [],
  plan: null,
  edition: null,
  flags: [],
  feature: null,
  featureSource: "ANY",
};

/** An edition some Business is on, as the directory counts it. */
export type EditionCountDto = { id: string; plan: PlanName; number: number; count: number };

export type DirectoryPageDto = {
  rows: DirectoryRowDto[];
  total: number;
  /** What each option would show, with the other groups' filters applied. */
  counts: {
    total: number;
    statuses: Record<BillingStatus, number>;
    plans: Record<PlanName, number>;
    /** Absent from an API older than Plan editions. */
    editions?: EditionCountDto[];
    flags: Record<BillingFlag, number>;
    features?: Record<FeatureName, number>;
    featureSources?: Record<FeatureFrom, number>;
  };
};

export type MonthCountDto = { monthStart: string; count: number };

export type WeeklyAppointmentActivityDto = {
  weekStart: string;
  confirmed: number;
  cancelled: number;
  noShow: number;
  completed: number;
};

export type BusinessVolumeDto = { businessId: string; businessName: string; count: number };

export type PlatformStatsDto = {
  statusCounts: Record<BillingStatus, number>;
  planCounts: Record<PlanName, number>;
  monthlyRecurringRevenueMinor: number;
  totalUsers: number;
  businessSignupsByMonth: MonthCountDto[];
  userSignupsByMonth: MonthCountDto[];
  appointmentActivityByWeek: WeeklyAppointmentActivityDto[];
  topBusinesses: BusinessVolumeDto[];
};

export type AuditEntryDto = {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  occurredAt: string;
};

export type SessionDto = {
  token: string;
  isNewUser: boolean;
  user: MeDto;
};

export type RequestCodeDto = {
  expiresInSeconds: number;
  /** Present only on a deployment with no delivery channel configured. */
  code?: string;
};

export type AllowlistEntryDto = { phone: string; note: string | null };

export type UserLookupDto =
  | { exists: false }
  | { exists: true; givenName: string; familyName: string | null };

/** A Business's calendars as an administrator settles its Resource Allowance. */
export type AdminCalendarsDto = {
  resourceAllowance: number;
  /** How many calendars on offer are beyond the Allowance; 0 when within it. */
  overBy: number;
  calendars: (ResourceDto & { upcoming: number })[];
};
