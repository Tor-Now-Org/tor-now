import type { Instant, UserId } from "@tor-now/domain";

/**
 * ADR 0006. One append-only record per significant mutation, written inside the
 * same transaction as the mutation it describes.
 */
export type AuditEntry = {
  readonly actorId: UserId | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
};

export type AuditSink = {
  append(entry: AuditEntry): Promise<void>;
};

/**
 * The actions the log distinguishes. A closed set rather than free text,
 * because the log is read by people asking specific questions of it.
 */
export const AUDIT_ACTIONS = {
  appointmentBooked: "APPOINTMENT_BOOKED",
  appointmentCancelled: "APPOINTMENT_CANCELLED",
  appointmentRescheduled: "APPOINTMENT_RESCHEDULED",
  appointmentNoShow: "APPOINTMENT_NO_SHOW",
  appointmentNoShowCleared: "APPOINTMENT_NO_SHOW_CLEARED",
  businessRegistered: "BUSINESS_REGISTERED",
  businessUpdated: "BUSINESS_UPDATED",
  businessActivated: "BUSINESS_ACTIVATED",
  businessDeactivated: "BUSINESS_DEACTIVATED",
  serviceCreated: "SERVICE_CREATED",
  serviceUpdated: "SERVICE_UPDATED",
  serviceDeleted: "SERVICE_DELETED",
  resourceCreated: "RESOURCE_CREATED",
  resourceUpdated: "RESOURCE_UPDATED",
  resourceDeleted: "RESOURCE_DELETED",
  /** Taken out of booking, or put back, for the Resource Allowance (ADR 0019). */
  resourcePaused: "RESOURCE_PAUSED",
  resourceResumed: "RESOURCE_RESUMED",
  workingHoursChanged: "WORKING_HOURS_CHANGED",
  dateOverrideChanged: "DATE_OVERRIDE_CHANGED",
  blockCreated: "BLOCK_CREATED",
  blockDeleted: "BLOCK_DELETED",
  businessPhotoChanged: "BUSINESS_PHOTO_CHANGED",
  businessPhotoRemoved: "BUSINESS_PHOTO_REMOVED",
  reviewSubmitted: "REVIEW_SUBMITTED",
  reviewEdited: "REVIEW_EDITED",
  userUpdated: "USER_UPDATED",
  userDeleted: "USER_DELETED",
  userRestored: "USER_RESTORED",
  /**
   * ADR 0008's erasure. The entry records that it happened and to which row;
   * it deliberately carries none of the values removed, because a trail that
   * retained them would defeat the request it is recording.
   */
  userAnonymised: "USER_ANONYMISED",
  /**
   * A change to who works at a Business and what they may reach. Audited for the
   * same reason administrator grants are: it is a permission change, and the log
   * is the only place to ask later who granted it.
   */
  membershipRoleChanged: "MEMBERSHIP_ROLE_CHANGED",
  membershipRemoved: "MEMBERSHIP_REMOVED",
  membershipResourceAssigned: "MEMBERSHIP_RESOURCE_ASSIGNED",
  membershipResourceUnassigned: "MEMBERSHIP_RESOURCE_UNASSIGNED",
  administratorGranted: "ADMINISTRATOR_GRANTED",
  administratorRevoked: "ADMINISTRATOR_REVOKED",
  allowlistChanged: "ADMINISTRATOR_ALLOWLIST_CHANGED",
  paymentRecorded: "PAYMENT_RECORDED",
  /** A new Business's Plan and Trial, as its owner started them (ADR 0020). */
  subscriptionStarted: "SUBSCRIPTION_STARTED",
  /**
   * Any later change to what a Subscription is on or paid through — by an
   * administrator, or by the job carrying out a scheduled move.
   */
  subscriptionChanged: "SUBSCRIPTION_CHANGED",
  /** ADR 0021: a Feature given to one Business, or its end moved. */
  grantGiven: "GRANT_GIVEN",
  grantChanged: "GRANT_CHANGED",
  /** ADR 0022: what a unit of messaging cost from a day, as an administrator entered it. */
  unitRateSet: "UNIT_RATE_SET",
  /** ADR 0021: a Plan's new edition, what a change gave carried onto one, or a pending one cancelled. */
  planEditionPublished: "PLAN_EDITION_PUBLISHED",
  planTermsImproved: "PLAN_TERMS_IMPROVED",
  planEditionWithdrawn: "PLAN_EDITION_WITHDRAWN",
  /** ADR 0020: a Preview started, its end moved, or where its Feature goes decided. */
  previewStarted: "PREVIEW_STARTED",
  previewEndMoved: "PREVIEW_END_MOVED",
  previewPlaced: "PREVIEW_PLACED",
  /** ADR 0021: an Add-on's sale opened, repriced, its rise withdrawn, or stopped. */
  addonOfferChanged: "ADDON_OFFER_CHANGED",
  /** ADR 0021: an Add-on added, ended — cancelled, or included by the Plan — resumed, or repriced for its holder. */
  addonAdded: "ADDON_ADDED",
  addonEnded: "ADDON_ENDED",
  addonResumed: "ADDON_RESUMED",
  addonPricesSet: "ADDON_PRICES_SET",
  /** Days owed beyond a monthly price: an Add-on added back, a Plan moved up to again. */
  daysOwedAdded: "DAYS_OWED_ADDED",
  /** ADR 0023: a Fair Use Limit changed — a cause's, or the daily one for sign-in codes. */
  fairUseLimitSet: "FAIR_USE_LIMIT_SET",
  /** ADR 0023: the Cost Calculator's saved Businesses, kept, changed, renamed or deleted. */
  referenceBusinessSaved: "REFERENCE_BUSINESS_SAVED",
  referenceBusinessUpdated: "REFERENCE_BUSINESS_UPDATED",
  referenceBusinessRenamed: "REFERENCE_BUSINESS_RENAMED",
  referenceBusinessDeleted: "REFERENCE_BUSINESS_DELETED",
  /** ADR 0023: a running cost added, or its amount from a day entered. */
  runningCostSet: "RUNNING_COST_SET",
  /**
   * ADR 0006: administrator reads of a customer record are audited as well as
   * writes. An unlogged read on the service_role path would be undetectable,
   * and it is the only oversight mechanism covering it.
   */
  customerRecordRead: "CUSTOMER_RECORD_READ",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditLogEntry = AuditEntry & {
  readonly id: string;
  readonly occurredAt: Instant;
};

export type AuditReader = {
  recent(limit: number, offset: number): Promise<readonly AuditLogEntry[]>;
};
