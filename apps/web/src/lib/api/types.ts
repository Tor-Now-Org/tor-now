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
  active: boolean;
  defaultBufferMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  cancellationWindowHours: number;
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
};

/** One square of the owner's month grid. */
export type MonthDayDto = {
  date: string;
  /** Appointments that still stand; a cancelled one is not counted. */
  appointments: number;
  blocks: number;
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
  priceMinor: number;
  price: number;
  durationMinutes: number;
  customerNote: string | null;
  cancelledAt: string | null;
  cancelledBy: "CUSTOMER" | "BUSINESS" | null;
  lateCancellation: boolean;
  createdAt: string;
};

export type MyAppointmentDto = AppointmentDto & {
  businessName: string;
};

export type CalendarAppointmentDto = AppointmentDto & {
  customerName: string;
  customerPhone: string;
};

/** One picture of a business. Slot 0 is the cover; 1-3 are the rest. */
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
};

export type CalendarDayDto = {
  date: string;
  appointments: CalendarAppointmentDto[];
  blocks: BlockDto[];
};

export type CustomerRecordDto = {
  user: UserDto;
  appointments: AppointmentDto[];
  lateCancellations: number;
  noShows: number;
};

export type SubscriptionDto = {
  id: string;
  businessId: string;
  plan: "FREE" | "STANDARD";
  amountMinor: number;
  amount: number;
  billingPeriod: "MONTHLY" | "YEARLY";
  paidThrough: string;
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

export type SubscriptionState = "CURRENT" | "IN_GRACE" | "LAPSED";

export type BusinessSummaryDto = {
  business: BusinessDto;
  subscription: SubscriptionDto | null;
  subscriptionState: SubscriptionState | null;
  ownerName: string | null;
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
  user: UserDto;
};

export type RequestCodeDto = {
  expiresInSeconds: number;
  /** Present only on a deployment with no delivery channel configured. */
  code?: string;
};

export type AllowlistEntryDto = { phone: string; note: string | null };
