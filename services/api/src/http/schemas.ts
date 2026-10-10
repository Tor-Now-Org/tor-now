import { z } from "zod";
import {
  SERVICE_MINUTES,
  bareHandle,
  checkCategories,
  currentCategory,
  INSTAGRAM_PATTERN,
  MAX_CATEGORIES,
  PHONE_PATTERN,
  BILLING_FLAGS,
  CHANGE_OUTCOMES,
  daysBetween,
  MAX_AVAILABILITY_DAYS,
  parseLocalDate,
  BILLING_STATUSES,
  COST_UNITS,
  FEATURES,
  PLANS,
  RATE_SOURCE_LENGTH,
  REVIEW_STARS,
  TEXT_RULES,
  type BusinessCategory,
  type CategoriesProblem,
  type TextRule,
} from "@tor-now/domain";
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
  .min(10, "A phone number must be at least 9 digits")
  .regex(PHONE_PATTERN, "A phone number must be in international form, e.g. +972501234567");

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-4]):[0-5]\d$/, "A time must look like HH:MM");

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date must look like YYYY-MM-DD");

const instantSchema = z.string().datetime({ offset: true });

const uuidSchema = z.string().uuid();

/** An id in the address, checked before it reaches a uuid column. */
export const noticeIdSchema = uuidSchema;
export const businessIdSchema = uuidSchema;

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
  // A link saved before ADR 0024 may name a retired code; it browses the one it joined.
  category: z
    .string()
    .transform((code, context) => currentCategory(code) ?? unknownCategory(context))
    .optional(),
  // The customer's position, when they shared it: orders a browse nearest first.
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * ADR 0026: a span runs forward, and covers a month at most. Checked here so a
 * request for a year of schedule is refused before it reaches the database.
 */
const spanFits = (range: { from?: string | undefined; to?: string | undefined }): boolean => {
  if (range.from === undefined || range.to === undefined) return true;
  try {
    const span = daysBetween(parseLocalDate(range.from), parseLocalDate(range.to));
    return span >= 0 && span < MAX_AVAILABILITY_DAYS;
  } catch {
    // A date that does not exist is refused by the date's own check.
    return true;
  }
};

const SPAN_MESSAGE = `A span runs forward and covers at most ${MAX_AVAILABILITY_DAYS} days`;

export const availabilitySchema = z
  .object({
    serviceId: uuidSchema,
    resourceId: uuidSchema,
    from: localDateSchema,
    to: localDateSchema,
  })
  .refine(spanFits, { message: SPAN_MESSAGE });

/**
 * ADR 0018. Joining a waiting list, or rewriting what was asked for: the same
 * request either way, because asking twice is the same ask.
 */
export const waitingSchema = z.object({
  businessId: uuidSchema,
  serviceId: uuidSchema,
  /** One, several, or all of the Business's calendars. Never empty. */
  resourceIds: z.array(uuidSchema).min(1).max(50),
  onDate: localDateSchema,
  /** Wanting all three is what "any time" means; the domain refuses none. */
  parts: z.array(z.enum(["MORNING", "NOON", "EVENING"])).min(1).max(3),
});

export const cancellationSchema = z.object({
  /**
   * Whether the hour this frees is published to whoever is waiting for it.
   *
   * Defaulted to true, and meaningful only when a Business is cancelling: a
   * customer cancelling wants the hour gone and has no opinion about who hears
   * about it. An older client that sends nothing therefore publishes, which is
   * the behaviour the feature exists for.
   */
  publishFreedTime: z.boolean().default(true),
});

export const bookingSchema = z.object({
  businessId: uuidSchema,
  serviceId: uuidSchema,
  resourceId: uuidSchema,
  startAt: instantSchema,
  customerNote: z.string().trim().max(500).nullable().default(null),
  /**
   * Sent when the customer has been told they already hold an appointment for
   * this service that day and has said to go ahead anyway. Absent means "not
   * asked yet", so a first attempt still stops and explains itself.
   */
  bookingAnotherOfTheSame: z.boolean().default(false),
  /**
   * Sent when the customer has been told this time runs across an appointment
   * they already hold elsewhere and has said to go ahead anyway. Separate from
   * the flag above: two different questions deserve two different answers, and
   * one "yes" should not stand in for the other.
   */
  bookingOverAnother: z.boolean().default(false),
  /**
   * Who the appointment is for, when somebody is booking on their behalf.
   *
   * Absent means the caller. Present, it is the Business booking a customer in
   * — over the telephone, or at the desk — and the caller must have access to
   * the calendar being filled.
   */
  forCustomerId: uuidSchema.optional(),
});

export const addCustomerSchema = z.object({
  phone: phoneSchema,
  givenName: z.string().trim().min(1).max(60),
  familyName: z.string().trim().max(60).nullable().default(null),
});

export const rescheduleSchema = z.object({ startAt: instantSchema });

export const reviewSchema = z.object({
  stars: z.number().int().min(REVIEW_STARS.min).max(REVIEW_STARS.max),
  comment: text(TEXT_RULES.reviewComment).default(""),
  anonymous: z.boolean().default(false),
});

export const customerNoteSchema = z.object({
  customerNote: z.string().trim().max(500).nullable(),
});

const workingHoursEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    start: localTimeSchema,
    end: localTimeSchema,
  })
  .refine((range) => range.end > range.start, {
    message: "A range must end after it starts",
  });

/**
 * A handle as people write it — with the @, or pasted as a profile URL — kept
 * as the bare handle. Refusing the forms everybody uses would be pedantry.
 */
const instagramSchema = z
  .string()
  .transform(bareHandle)
  .refine((handle) => INSTAGRAM_PATTERN.test(handle), {
    message: "An Instagram handle: letters, digits, dots or underscores",
  });

/**
 * ADR 0024: one to three Categories, the first the main one. The rule itself is
 * the domain's, so the wizard refuses exactly what this refuses.
 */
const CATEGORIES_PROBLEMS: Readonly<Record<CategoriesProblem, string>> = {
  NONE: "Choose at least one category",
  TOO_MANY: `At most ${MAX_CATEGORIES} categories`,
  UNKNOWN: "Not a category on the list",
  REPEATED: "The same category twice",
};

const unknownCategory = (context: z.RefinementCtx): never => {
  context.addIssue({ code: z.ZodIssueCode.custom, message: CATEGORIES_PROBLEMS.UNKNOWN });
  return z.NEVER;
};

const categoryList = (codes: readonly string[], context: z.RefinementCtx) => {
  const checked = checkCategories(codes);
  if (checked.ok) return checked.categories;
  context.addIssue({ code: z.ZodIssueCode.custom, message: CATEGORIES_PROBLEMS[checked.problem] });
  return z.NEVER;
};

const categoryFields = {
  categories: z.array(z.string()).transform(categoryList).optional(),
  /** Before ADR 0024 a Business had one; a client that still sends it means a list of one. */
  category: z
    .string()
    .transform((code, context) => categoryList([code], context))
    .optional(),
};

type CategoryFields = {
  readonly categories?: readonly BusinessCategory[] | undefined;
  readonly category?: readonly BusinessCategory[] | undefined;
};

/** Folds the old single field into the list, refusing a body that sends both. */
const oneCategoryList = <T extends CategoryFields>(
  { category, categories, ...rest }: T,
  context: z.RefinementCtx,
): Omit<T, "category" | "categories"> & { categories?: readonly BusinessCategory[] } => {
  if (category !== undefined && categories !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category"],
      message: "Send categories, not category as well",
    });
    return z.NEVER;
  }
  const chosen = categories ?? category;
  return chosen === undefined ? rest : { ...rest, categories: chosen };
};

/** Registering, the list is required: a Business is found by what it is. */
const withCategories = <T extends CategoryFields>(value: T, context: z.RefinementCtx) => {
  const folded = oneCategoryList(value, context);
  if (folded.categories !== undefined) return { ...folded, categories: folded.categories };
  context.addIssue({ code: z.ZodIssueCode.custom, path: ["categories"], message: CATEGORIES_PROBLEMS.NONE });
  return z.NEVER;
};

export const registerBusinessSchema = z.object({
  name: text(TEXT_RULES.businessName),
  phone: phoneSchema,
  timeZone: z.string().min(1).optional(),
  description: text(TEXT_RULES.description).nullable().default(null),
  address: text(TEXT_RULES.address),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  ...categoryFields,
  /** Left out, the Business goes on the cheapest Plan with room for its calendars. */
  plan: z.enum(PLANS).optional(),
  resourceNames: z.array(text(TEXT_RULES.resourceName)).min(1),
  services: z
    .array(
      z.object({
        name: text(TEXT_RULES.serviceName),
        durationMinutes: z.number().int().min(SERVICE_MINUTES.min).max(SERVICE_MINUTES.max),
        priceMinor: z.number().int().min(0),
        bufferMinutes: z.number().int().min(0).max(240).nullable().default(null),
      }),
    )
    .min(1),
  workingHours: z.array(workingHoursEntrySchema).min(1),
}).transform(withCategories);

const updateBusinessFields = z.object({
  name: text(TEXT_RULES.businessName).optional(),
  phone: phoneSchema.optional(),
  timeZone: z.string().min(1).optional(),
  description: text(TEXT_RULES.description).nullable().optional(),
  address: text(TEXT_RULES.address).nullable().optional(),
  // Required to register and what search needs to show it: changeable, never clearable.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // ADR 0017, 0024: changeable, never clearable — a business that has some keeps one.
  ...categoryFields,
  instagram: instagramSchema.nullable().optional(),
  whatsapp: phoneSchema.nullable().optional(),
  defaultBufferMinutes: z.number().int().min(0).max(240).optional(),
  minimumNoticeMinutes: z.number().int().min(0).max(43200).optional(),
  bookingHorizonDays: z.number().int().min(1).max(365).optional(),
  cancellationWindowHours: z.number().int().min(0).max(720).optional(),
});

export const updateBusinessSchema = updateBusinessFields.transform(oneCategoryList);

export const serviceSchema = z.object({
  name: text(TEXT_RULES.serviceName),
  durationMinutes: z.number().int().min(SERVICE_MINUTES.min).max(SERVICE_MINUTES.max),
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

/**
 * Adding somebody to the team. The phone number is the identity — it is the only
 * thing about a colleague the person inviting reliably knows — and the resources
 * are what a WORKER may see, checked against the role by the service.
 */
export const userLookupSchema = z.object({ phone: phoneSchema });

export const invitationSchema = personName.extend({
  phone: phoneSchema,
  role: z.enum(["OWNER", "MANAGER", "WORKER"]),
  resourceIds: z.array(uuidSchema).max(50).optional(),
});

export const membershipUpdateSchema = z.object({
  role: z.enum(["OWNER", "MANAGER", "WORKER"]).optional(),
  resourceIds: z.array(uuidSchema).max(50).optional(),
});

export const workingHoursSchema = workingHoursEntrySchema;

/**
 * A whole week in one request. Capped generously: seven days of a few stretches
 * each is the honest maximum, and an unbounded array is an unbounded insert.
 */
export const weekSchema = z.object({
  week: z.array(workingHoursEntrySchema).max(50),
});

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

const blockSpanSchema = z.object({
  startAt: instantSchema,
  endAt: instantSchema,
  reason: text(TEXT_RULES.reason).default(""),
});

/**
 * A blockage, which may be more than one span: a week away is seven days, and
 * a lunch break kept for a fortnight is fourteen. They arrive together because
 * they are one decision, and half a blockage is worse than none.
 *
 * Capped at two months of daily spans — beyond that it is a working-hours
 * change, not a blockage.
 */
export const blocksSchema = z.object({
  blocks: z.array(blockSpanSchema).min(1).max(62),
  /**
   * What becomes of the appointments already inside it.
   *
   * Defaulted, unlike a closure's, because this route was deployed before the
   * question was asked: an older client that does not send it means what it
   * has always meant, which is to leave them standing.
   */
  upcoming: z.enum(["KEEP", "CANCEL"]).default("KEEP"),
});

/** The same spans, asked about rather than made. */
export const blockPreviewSchema = z.object({
  blocks: z.array(blockSpanSchema).min(1).max(62),
});

/**
 * The shop closing, or keeping different hours, over a run of days.
 *
 * The same shape says both: no ranges is shut, some ranges are the hours kept.
 * `upcoming` is the caller's answer for the people already booked inside those
 * days — there is no default, because both answers are wrong by default.
 *
 * Capped at a season. Longer than that is not a closure, it is a business that
 * has changed its working week.
 */
export const closureSchema = z.object({
  fromDate: localDateSchema,
  toDate: localDateSchema,
  note: text(TEXT_RULES.reason).nullable().default(null),
  ranges: z
    .array(
      z
        .object({ start: localTimeSchema, end: localTimeSchema })
        .refine((range) => range.end > range.start, {
          message: "A range must end after it starts",
        }),
    )
    .default([]),
  upcoming: z.enum(["KEEP", "CANCEL"]),
});

/** Changing what a closure is called, and nothing else about it. */
export const closureNoteSchema = z.object({
  fromDate: localDateSchema,
  toDate: localDateSchema,
  note: text(TEXT_RULES.reason).nullable().default(null),
});

/** Changing what a blockage is called. */
export const blockNoteSchema = z.object({
  reason: text(TEXT_RULES.reason).default(""),
});

/** The same question without the answer: what would closing these days cost? */
export const closurePreviewSchema = closureSchema.omit({ note: true, upcoming: true });

/**
 * "שינוי ביומן": who it is for, the days, and what happens on them. The hours are
 * checked by the service, which says what is wrong with them in one place.
 */
const changeScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BUSINESS") }),
  z.object({ kind: z.literal("CALENDAR"), resourceId: uuidSchema }),
]);

const changeRangesSchema = z
  .array(z.object({ start: localTimeSchema, end: localTimeSchema }))
  .max(12)
  .default([]);

/** The change being edited, by the id a list or a detail gave. */
const replacingSchema = z.string().min(1).max(200).nullable().default(null);

export const changePreviewSchema = z.object({
  scope: changeScopeSchema,
  fromDate: localDateSchema,
  toDate: localDateSchema,
  // Still unanswered while the sheet is opening; the usual hours come back regardless.
  outcome: z.enum(CHANGE_OUTCOMES).nullable().default(null),
  ranges: changeRangesSchema,
  replacing: replacingSchema,
});

export const changeSchema = z.object({
  scope: changeScopeSchema,
  fromDate: localDateSchema,
  toDate: localDateSchema,
  outcome: z.enum(CHANGE_OUTCOMES),
  ranges: changeRangesSchema,
  note: text(TEXT_RULES.reason).nullable().default(null),
  upcoming: z.enum(["KEEP", "CANCEL"]),
  replacing: replacingSchema,
});

/** Removing one day of a change rather than all of it. */
export const changeRemovalSchema = z.object({ date: localDateSchema.optional() });

export const dateRangeSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
});

export const calendarDaySchema = z.object({ date: localDateSchema });

/** ADR 0018: the customer's own list, optionally for one Business. */
export const waitingListSchema = z.object({
  businessId: z.string().uuid().nullable().catch(null).default(null),
});

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

/** A month of statistics, for the whole Business or one calendar. */
export const statisticsSchema = calendarMonthSchema.extend({
  resourceId: uuidSchema.optional(),
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
  )
  .refine(spanFits, { message: SPAN_MESSAGE });

export const paymentSchema = z.object({
  amountMinor: z.number().int().positive(),
  paidOn: localDateSchema,
  note: z.string().trim().max(200).nullable().default(null),
});

/** ADR 0019: the calendars that stay on offer; every other one is paused. */
export const keptCalendarsSchema = z.object({
  resourceIds: z.array(z.string().uuid()).min(1),
});

/** ADR 0020: an administrator moves a Business to another Plan by the owner's rule. */
export const planChangeSchema = z.object({
  plan: z.enum(PLANS),
  /** The calendars that stay, when the new Plan has room for fewer. */
  keep: z.array(z.string().uuid()).optional(),
});

/** ADR 0022: an administrator's figure for one unit of messaging, from a day. */
export const unitRateSchema = z.object({
  unit: z.enum(COST_UNITS),
  effectiveFrom: localDateSchema,
  microShekels: z.number().int().min(0).max(100_000_000),
  source: z.string().trim().min(RATE_SOURCE_LENGTH.min).max(RATE_SOURCE_LENGTH.max),
});

/** ADR 0021: several Features given at once, with one end and one reason. */
export const grantSchema = z.object({
  features: z.array(z.enum(FEATURES)).min(1).max(FEATURES.length),
  endsOn: localDateSchema,
  reason: z.string().trim().min(TEXT_RULES.auditReason.min).max(TEXT_RULES.auditReason.max),
});

export const grantExtensionSchema = grantSchema.omit({ features: true });

/** An id in the address, checked before it reaches a uuid column. */
export const grantIdSchema = uuidSchema;

/** A Plan named in the address. */
export const planParamSchema = z.enum(PLANS);

/** A Feature named in the address. */
export const featureParamSchema = z.enum(FEATURES);

/** ADR 0020: a Preview's last day — starting one, or extending it. */
export const previewEndSchema = z.object({ endsOn: localDateSchema });

/** ADR 0020: which Plans keep a Preview's Feature when it ends. */
export const previewPlacementSchema = z.object({
  keepOn: z.array(z.enum(PLANS)).max(PLANS.length),
  /** ADR 0021: sold on its own, at this price, to the Plans that do not keep it. */
  addonPriceMinor: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

/** ADR 0021: an Add-on's monthly price, as it goes on sale or changes. The service decides what the change is. */
export const addonPriceSchema = z.object({ priceMinor: z.number().int().min(1).max(1_000_000) });

/** ADR 0021: which Plans include a Feature, from its own card. */
export const featurePlansSchema = z.object({ plans: z.array(z.enum(PLANS)).max(PLANS.length) });

/** ADR 0021: a Plan's terms as the administrator edits them. The service decides what the change is. */
export const planEditSchema = z.object({
  priceMinor: z.number().int().min(0).max(10_000_000),
  resourceAllowance: z.number().int().min(1).max(100),
  features: z.array(z.enum(FEATURES)).max(FEATURES.length),
});

export const adminBusinessUpdateSchema = updateBusinessFields
  .extend({
    /** ADR 0010: an edit on the owner's behalf records why it was made. */
    reason: z.string().trim().min(TEXT_RULES.auditReason.min).max(TEXT_RULES.auditReason.max),
  })
  .transform(oneCategoryList);

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

export const blockedFlagSchema = z.object({ blocked: z.boolean() });

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

/**
 * The directory's filters, as a query string an administrator can bookmark:
 * `?status=TRIAL,IN_GRACE&plan=TEAM&flag=TRIAL_ENDING&q=רן`. Lists are
 * comma-separated; an unknown value is refused rather than silently ignored.
 */
const commaList = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === "" ? [] : raw.split(",").map((part) => part.trim())))
    .pipe(z.array(z.enum(values)));

export const directoryQuerySchema = z.object({
  q: z.string().trim().min(1).nullable().catch(null).default(null),
  status: commaList(BILLING_STATUSES),
  plan: z.enum(PLANS).nullable().default(null),
  edition: uuidSchema.nullable().default(null),
  flag: commaList(BILLING_FLAGS),
  feature: z.enum(FEATURES).nullable().default(null),
  from: z.enum(["ANY", "PLAN", "GRANT", "PREVIEW"]).default("ANY"),
});

export const statsQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(8),
  months: z.coerce.number().int().min(1).max(36).default(12),
});
