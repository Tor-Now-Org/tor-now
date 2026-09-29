import { z } from "zod";
import { BUSINESS_MESSAGE_SOURCES, FAIR_USE_SOURCES } from "@tor-now/domain";

/**
 * The shapes the Cost tab's requests take (ADR 0023). The domain checks every
 * rule that matters — ranges, names, room for another; these only make sure
 * the request is the right shape before it gets there.
 */

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date must look like YYYY-MM-DD");

export const uuidParamSchema = z.string().uuid();

/** `?month=2026-09`, or nothing for this month. */
export const monthQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month must look like YYYY-MM")
    .optional(),
});

const countSchema = z.number().int();

const useSchema = z.object({
  calendars: countSchema,
  ...(Object.fromEntries(
    BUSINESS_MESSAGE_SOURCES.map((source) => [source, z.object({ whatsapp: countSchema, sms: countSchema })]),
  ) as Record<(typeof BUSINESS_MESSAGE_SOURCES)[number], z.ZodObject<{ whatsapp: typeof countSchema; sms: typeof countSchema }>>),
});

export const saveReferenceSchema = z.object({ name: z.string().max(200), use: useSchema });
export const updateReferenceSchema = z.object({ use: useSchema });
export const renameReferenceSchema = z.object({ name: z.string().max(200) });

const amountSchema = z.object({
  amountMinor: z.number().int(),
  effectiveFrom: localDateSchema,
  source: z.string().max(1000),
});

export const addRunningCostSchema = amountSchema.extend({ name: z.string().max(200) });
export const runningCostAmountSchema = amountSchema;

export const fairUseSourceParamSchema = z.enum(FAIR_USE_SOURCES);
export const businessLimitSchema = z.object({ amountMinor: z.number().int() });
export const signInLimitSchema = z.object({ codesPerDay: z.number().int() });
