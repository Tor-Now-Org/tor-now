import {
  asId,
  dayOfWeek,
  instant,
  localTime,
  money,
  parseLocalDate,
  timeZone,
  type Appointment,
  type Block,
  type Business,
  type BusinessPhoto,
  type DateOverride,
  type Membership,
  type Payment,
  type Resource,
  type PhotoSlot,
  type Service,
  type Subscription,
  type User,
  type WorkingHours,
} from "@tor-now/domain";

/**
 * One place where a database row becomes a domain value. Every branded type is
 * constructed through its own validator here, so a row that violates a domain
 * rule fails loudly at the boundary rather than travelling inwards disguised as
 * a valid value.
 */

export type Row = Record<string, unknown>;

/**
 * A column value as text. Postgres hands back strings, numbers and Dates for
 * the columns this module reads; anything else is a schema change nobody
 * updated the mapper for, and failing here is better than storing "[object
 * Object]" and discovering it later.
 */
const text = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Expected a text-like column value, got ${typeof value}`);
};
const nullableText = (value: unknown): string | null =>
  value === null || value === undefined ? null : text(value);
const int = (value: unknown): number => Number(value);
const bool = (value: unknown): boolean => Boolean(value);

/**
 * The column is checked to 0..3 by the schema, so a value outside it means the
 * schema and this file have drifted apart — which is worth a loud failure at
 * the boundary rather than a photo appearing in a slot nothing renders.
 */
const photoSlot = (value: number): PhotoSlot => {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  throw new Error(`A photo slot must be 0..3, got ${value}`);
};
const toInstant = (value: unknown) => instant(new Date(value as string).getTime());
const nullableInstant = (value: unknown) =>
  value === null || value === undefined ? null : toInstant(value);

/** Postgres `date` arrives as a Date in UTC; only its calendar day matters. */
export const toLocalDate = (value: unknown) => {
  const iso =
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return parseLocalDate(iso);
};
const nullableLocalDate = (value: unknown) =>
  value === null || value === undefined ? null : toLocalDate(value);

export const toUser = (row: Row): User => ({
  id: asId(text(row["id"])),
  phone: text(row["phone"]),
  givenName: text(row["given_name"]),
  familyName: nullableText(row["family_name"]),
  birthDate: nullableLocalDate(row["birth_date"]),
  deletedAt: nullableInstant(row["deleted_at"]),
  anonymisedAt: nullableInstant(row["anonymised_at"]),
  isAdministrator: bool(row["is_administrator"]),
  createdAt: toInstant(row["created_at"]),
});

export const toBusiness = (row: Row): Business => ({
  id: asId(text(row["id"])),
  name: text(row["name"]),
  phone: text(row["phone"]),
  timeZone: timeZone(text(row["time_zone"])),
  description: nullableText(row["description"]),
  address: nullableText(row["address"]),
  active: bool(row["active"]),
  defaultBufferMinutes: int(row["default_buffer_minutes"]),
  minimumNoticeMinutes: int(row["minimum_notice_minutes"]),
  bookingHorizonDays: int(row["booking_horizon_days"]),
  cancellationWindowHours: int(row["cancellation_window_hours"]),
});

export const toBusinessPhoto = (row: Row): BusinessPhoto => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  // The column is constrained to 0..3, so this is the one place the range is
  // asserted rather than assumed on the way back in.
  slot: photoSlot(int(row["position"])),
  storagePath: text(row["storage_path"]),
  contentType: text(row["content_type"]),
  byteSize: int(row["byte_size"]),
});

export const toMembership = (row: Row): Membership => ({
  id: asId(text(row["id"])),
  userId: asId(text(row["user_id"])),
  businessId: asId(text(row["business_id"])),
  role: text(row["role"]) as Membership["role"],
  createdAt: toInstant(row["created_at"]),
});

export const toResource = (row: Row): Resource => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  name: text(row["name"]),
  active: bool(row["active"]),
});

export const toService = (row: Row): Service => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  name: text(row["name"]),
  durationMinutes: int(row["duration_minutes"]),
  price: money(int(row["price_minor"])),
  bufferMinutes:
    row["buffer_minutes"] === null || row["buffer_minutes"] === undefined
      ? null
      : int(row["buffer_minutes"]),
  active: bool(row["active"]),
});

export const toWorkingHours = (row: Row): WorkingHours => ({
  id: asId(text(row["id"])),
  resourceId: asId(text(row["resource_id"])),
  businessId: asId(text(row["business_id"])),
  dayOfWeek: dayOfWeek(int(row["day_of_week"])),
  start: localTime(int(row["start_local"])),
  end: localTime(int(row["end_local"])),
});

export const toDateOverride = (
  row: Row,
  ranges: readonly Row[],
): DateOverride => ({
  id: asId(text(row["id"])),
  resourceId: asId(text(row["resource_id"])),
  businessId: asId(text(row["business_id"])),
  date: toLocalDate(row["on_date"]),
  note: nullableText(row["note"]),
  ranges: ranges.map((range) => ({
    start: localTime(int(range["start_local"])),
    end: localTime(int(range["end_local"])),
  })),
});

export const toBlock = (row: Row): Block => ({
  id: asId(text(row["id"])),
  resourceId: asId(text(row["resource_id"])),
  businessId: asId(text(row["business_id"])),
  startAt: toInstant(row["start_at"]),
  endAt: toInstant(row["end_at"]),
  reason: text(row["reason"]),
});

export const toAppointment = (row: Row): Appointment => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  resourceId: asId(text(row["resource_id"])),
  serviceId: asId(text(row["service_id"])),
  customerId: asId(text(row["customer_id"])),
  startAt: toInstant(row["start_at"]),
  endAt: toInstant(row["end_at"]),
  occupiedUntil: toInstant(row["occupied_until"]),
  status: text(row["status"]) as Appointment["status"],
  serviceName: text(row["service_name"]),
  price: money(int(row["price_minor"])),
  durationMinutes: int(row["duration_minutes"]),
  bufferMinutes: int(row["buffer_minutes"]),
  customerNote: nullableText(row["customer_note"]),
  cancelledAt: nullableInstant(row["cancelled_at"]),
  cancelledBy: (nullableText(row["cancelled_by"]) as Appointment["cancelledBy"]),
  lateCancellation: bool(row["late_cancellation"]),
  reminderEnqueuedAt: nullableInstant(row["reminder_enqueued_at"]),
  createdAt: toInstant(row["created_at"]),
});

export const toSubscription = (row: Row): Subscription => ({
  id: asId(text(row["id"])),
  businessId: asId(text(row["business_id"])),
  plan: text(row["plan"]) as Subscription["plan"],
  amount: money(int(row["amount_minor"])),
  billingPeriod: text(row["billing_period"]) as Subscription["billingPeriod"],
  paidThrough: toLocalDate(row["paid_through"]),
});

export const toPayment = (row: Row): Payment => ({
  id: asId(text(row["id"])),
  subscriptionId: asId(text(row["subscription_id"])),
  businessId: asId(text(row["business_id"])),
  amount: money(int(row["amount_minor"])),
  paidOn: toLocalDate(row["paid_on"]),
  recordedBy: asId(text(row["recorded_by"])),
  note: nullableText(row["note"]),
  recordedAt: toInstant(row["recorded_at"]),
});
