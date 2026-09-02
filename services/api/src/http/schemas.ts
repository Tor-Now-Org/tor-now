import { z } from "zod";
import { PHONE_PATTERN, TEXT_RULES, type TextRule } from "@tor-now/domain";
import { PAGINATION } from "../config.ts";

/**
 * Validation at the system boundary. Every request body and query string is
 * parsed into a known shape before any of it reaches the domain — nothing
 * downstream re-checks a field, because nothing downstream receives an
 * unchecked one.
 */

/**
 * The rules themselves live in the domain, so the browser refuses exactly what
 * this refuses and can say so before the request is made.
 */
const text = (rule: TextRule) =>
  rule.min === 0
    ? z.string().trim().max(rule.max)
    : z.string().trim().min(rule.min).max(rule.max);

/** E.164, which is also what the database's CHECK constraint enforces. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(PHONE_PATTERN, "A phone number must be in international form, e.g. +972501234567");

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-4]):[0-5]\d$/, "A time must look like HH:MM");

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date must look like YYYY-MM-DD");

const instantSchema = z.string().datetime({ offset: true });

const uuidSchema = z.string().uuid();

export const requestCodeSchema = z.object({ phone: phoneSchema });

const personName = z.object({
  givenName: text(TEXT_RULES.personName),
  familyName: text(TEXT_RULES.personName).nullable().default(null),
});

export const verifyCodeSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${TEXT_RULES.code.min},${TEXT_RULES.code.max}}$`)),
  /**
   * Accepts either shape. The screens send the two halves; a caller that only
   * has a single name — the seed script, an older client — sends a string and
   * it becomes the given name.
   */
  name: z
    .union([personName, text(TEXT_RULES.personName)])
    .nullable()
    .default(null)
    .transform((value) =>
      value === null
        ? null
        : typeof value === "string"
          ? { givenName: value, familyName: null }
          : value,
    ),
});

export const updateProfileSchema = z.object({
  givenName: text(TEXT_RULES.personName).optional(),
  familyName: text(TEXT_RULES.personName).nullable().optional(),
  birthDate: localDateSchema.nullable().optional(),
});

export const searchSchema = z.object({
  q: z.string().trim().default(""),
});

export const availabilitySchema = z.object({
  serviceId: uuidSchema,
  resourceId: uuidSchema,
  from: localDateSchema,
  to: localDateSchema,
});

export const bookingSchema = z.object({
  businessId: uuidSchema,
  serviceId: uuidSchema,
  resourceId: uuidSchema,
  startAt: instantSchema,
  customerNote: z.string().trim().max(500).nullable().default(null),
});

export const rescheduleSchema = z.object({ startAt: instantSchema });

const workingHoursEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    start: localTimeSchema,
    end: localTimeSchema,
  })
  .refine((range) => range.end > range.start, {
    message: "A range must end after it starts",
  });

export const registerBusinessSchema = z.object({
  name: text(TEXT_RULES.businessName),
  phone: phoneSchema,
  timeZone: z.string().min(1).optional(),
  description: text(TEXT_RULES.description).nullable().default(null),
  address: text(TEXT_RULES.address).nullable().default(null),
  resourceNames: z.array(text(TEXT_RULES.resourceName)).min(1),
  services: z
    .array(
      z.object({
        name: text(TEXT_RULES.serviceName),
        durationMinutes: z.number().int().min(5).max(1440),
        priceMinor: z.number().int().min(0),
        bufferMinutes: z.number().int().min(0).max(240).nullable().default(null),
      }),
    )
    .min(1),
  workingHours: z.array(workingHoursEntrySchema).min(1),
});

export const updateBusinessSchema = z.object({
  name: text(TEXT_RULES.businessName).optional(),
  phone: phoneSchema.optional(),
  timeZone: z.string().min(1).optional(),
  description: text(TEXT_RULES.description).nullable().optional(),
  address: text(TEXT_RULES.address).nullable().optional(),
  defaultBufferMinutes: z.number().int().min(0).max(240).optional(),
  minimumNoticeMinutes: z.number().int().min(0).max(43200).optional(),
  bookingHorizonDays: z.number().int().min(1).max(365).optional(),
  cancellationWindowHours: z.number().int().min(0).max(720).optional(),
});

export const serviceSchema = z.object({
  name: text(TEXT_RULES.serviceName),
  durationMinutes: z.number().int().min(5).max(1440),
  priceMinor: z.number().int().min(0),
  bufferMinutes: z.number().int().min(0).max(240).nullable().default(null),
});

export const serviceUpdateSchema = serviceSchema.partial().extend({
  active: z.boolean().optional(),
});

export const resourceSchema = z.object({
  name: text(TEXT_RULES.resourceName),
});

export const resourceUpdateSchema = z.object({
  name: text(TEXT_RULES.resourceName).optional(),
  active: z.boolean().optional(),
});

export const workingHoursSchema = workingHoursEntrySchema;

export const workingHoursUpdateSchema = z
  .object({ start: localTimeSchema, end: localTimeSchema })
  .refine((range) => range.end > range.start, {
    message: "A range must end after it starts",
  });

export const overrideSchema = z.object({
  date: localDateSchema,
  note: z.string().trim().max(200).nullable().default(null),
  /** An empty list is a day off, not an omission. */
  ranges: z
    .array(
      z
        .object({ start: localTimeSchema, end: localTimeSchema })
        .refine((range) => range.end > range.start, {
          message: "A range must end after it starts",
        }),
    )
    .default([]),
});

export const blockSchema = z.object({
  startAt: instantSchema,
  endAt: instantSchema,
  reason: text(TEXT_RULES.reason).default(""),
});

export const dateRangeSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
});

export const calendarDaySchema = z.object({ date: localDateSchema });

/** Below the minimum length the answer is noise, which the service also says. */
export const appointmentSearchSchema = z.object({
  q: z.string().trim().max(80).nullable().catch(null).default(null),
});

/**
 * A month is given as its first day rather than as "2026-09", so one date type
 * crosses the wire instead of two and the API never has to guess a day.
 */
export const calendarMonthSchema = z.object({
  firstOfMonth: localDateSchema.refine((value) => value.endsWith("-01"), {
    message: "A month is identified by its first day, e.g. 2026-09-01",
  }),
});

/** Both or neither; a half-given range is a mistake, not a default. */
export const optionalDateRangeSchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .refine(
    (range) => (range.from === undefined) === (range.to === undefined),
    { message: "from and to must be given together" },
  );

export const paymentSchema = z.object({
  amountMinor: z.number().int().positive(),
  paidOn: localDateSchema,
  note: z.string().trim().max(200).nullable().default(null),
});

export const subscriptionUpdateSchema = z.object({
  plan: z.enum(["FREE", "STANDARD"]).optional(),
  amountMinor: z.number().int().min(0).optional(),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
});

export const adminBusinessUpdateSchema = updateBusinessSchema.extend({
  /** ADR 0010: an edit on the owner's behalf records why it was made. */
  reason: z.string().trim().min(TEXT_RULES.auditReason.min).max(TEXT_RULES.auditReason.max),
});

/** ADR 0008: an erasure records why it was carried out, and cannot be undone. */
export const erasureSchema = z.object({
  reason: z.string().trim().min(TEXT_RULES.auditReason.min).max(TEXT_RULES.auditReason.max),
  confirm: z.literal(true),
});

export const allowlistSchema = z.object({
  phone: phoneSchema,
  note: z.string().trim().max(200).nullable().default(null),
});

export const activeFlagSchema = z.object({ active: z.boolean() });

export const administratorFlagSchema = z.object({ isAdministrator: z.boolean() });

export const pageSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.maxPageSize)
    .default(PAGINATION.defaultPageSize),
  offset: z.coerce.number().int().min(0).default(0),
});

export const queryTextSchema = z.object({
  q: z.string().trim().min(1).nullable().catch(null).default(null),
});
