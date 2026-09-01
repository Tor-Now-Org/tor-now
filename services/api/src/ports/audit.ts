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
  workingHoursChanged: "WORKING_HOURS_CHANGED",
  dateOverrideChanged: "DATE_OVERRIDE_CHANGED",
  blockCreated: "BLOCK_CREATED",
  blockDeleted: "BLOCK_DELETED",
  userUpdated: "USER_UPDATED",
  userDeleted: "USER_DELETED",
  userRestored: "USER_RESTORED",
  /**
   * ADR 0008's erasure. The entry records that it happened and to which row;
   * it deliberately carries none of the values removed, because a trail that
   * retained them would defeat the request it is recording.
   */
  userAnonymised: "USER_ANONYMISED",
  administratorGranted: "ADMINISTRATOR_GRANTED",
  administratorRevoked: "ADMINISTRATOR_REVOKED",
  allowlistChanged: "ADMINISTRATOR_ALLOWLIST_CHANGED",
  paymentRecorded: "PAYMENT_RECORDED",
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
