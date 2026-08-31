import { z } from "zod";

/**
 * Every setting the service reads, in one place, validated once at startup.
 * Nothing below is defaulted to a production value: a missing secret fails the
 * boot rather than silently running with a placeholder.
 */

const MINUTES = 60;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

/** ADR 0009: one refresh lifetime for every role, and no second place decides. */
export const SESSION_LIFETIME_SECONDS = 30 * DAYS;

export const VERIFICATION = Object.freeze({
  codeLength: 6,
  lifetimeSeconds: 5 * MINUTES,
  /** ADR 0004 narrows rate limiting to code issuance and code checking. */
  maxAttemptsPerCode: 5,
  maxCodesPerPhonePerWindow: 5,
  issuanceWindowSeconds: 15 * MINUTES,
});

export const SEARCH = Object.freeze({
  /** ADR 0011 ranks by similarity with a boost for prefix matches. */
  minimumQueryLength: 2,
  similarityThreshold: 0.2,
  prefixBoost: 0.35,
  maxResults: 20,
});

export const PAGINATION = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 100,
});

export const OUTBOX = Object.freeze({
  batchSize: 50,
  maxAttempts: 5,
});

/** ADR 0006: audit rows are retained for one year. */
export const AUDIT_RETENTION_DAYS = 365;

const transportSchema = z.enum(["LOG", "WHATSAPP", "SMS"]);

/**
 * Twilio has no credentials in this environment, so the transports that need
 * them are opt-in. `LOG` is a complete implementation of the port — it just
 * delivers to the log — which is what lets the whole verification and
 * notification path run end to end without a vendor.
 */
const schema = z.object({
  databaseUrl: z.string().min(1),
  jwtSecret: z.string().min(32, "must be at least 32 characters"),
  /** Which secret the signing key was derived from, reported by /health. */
  jwtSecretSource: z.enum(["SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]),
  /**
   * Supabase Cron authenticates to an Edge Function with the project's service
   * role key, which is how the scheduled endpoints are guarded — there is no
   * separate secret to provision, and nothing but the platform holds this one.
   */
  serviceRoleKey: z.string().min(1).nullable().default(null),
  verificationTransport: transportSchema.default("LOG"),
  notificationTransport: transportSchema.default("LOG"),
  twilio: z
    .object({
      accountSid: z.string().min(1),
      authToken: z.string().min(1),
      whatsappFrom: z.string().min(1),
      smsFrom: z.string().min(1).optional(),
    })
    .nullable()
    .default(null),
  /**
   * When true, the API returns the verification code in its own response.
   *
   * This is not a convenience. With `VERIFICATION_TRANSPORT=LOG` there is no
   * delivery channel at all, so a code that is not returned is a code nobody
   * can ever enter — the deployment would have no way to authenticate anyone.
   * It therefore defaults to on exactly when no real transport is configured,
   * and `assertCoherent` refuses the combination the moment one is, so
   * configuring Twilio turns it off rather than leaving it to be noticed.
   *
   * `EXPOSE_VERIFICATION_CODE=false` forces it off, which locks a credential-
   * less deployment out of its own sign-in — correct if that is what is wanted.
   */
  exposeVerificationCode: z.boolean(),
  corsOrigins: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof schema>;

export type Environment = Readonly<Record<string, string | undefined>>;

const ENVIRONMENT_VARIABLE: Readonly<Record<string, string>> = Object.freeze({
  databaseUrl: "SUPABASE_DB_URL",
  jwtSecret: "SUPABASE_JWT_SECRET",
  verificationTransport: "VERIFICATION_TRANSPORT",
  notificationTransport: "NOTIFICATION_TRANSPORT",
  exposeVerificationCode: "EXPOSE_VERIFICATION_CODE",
  corsOrigins: "CORS_ORIGINS",
  serviceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
});

const readBoolean = (
  value: string | undefined,
  whenUnset: boolean,
): boolean => (value === undefined ? whenUnset : value === "true");

const readTwilio = (env: Environment): Config["twilio"] => {
  const accountSid = env["TWILIO_ACCOUNT_SID"];
  const authToken = env["TWILIO_AUTH_TOKEN"];
  const whatsappFrom = env["TWILIO_WHATSAPP_FROM"];
  if (
    accountSid === undefined ||
    authToken === undefined ||
    whatsappFrom === undefined
  ) {
    return null;
  }
  const smsFrom = env["TWILIO_SMS_FROM"];
  return {
    accountSid,
    authToken,
    whatsappFrom,
    ...(smsFrom === undefined ? {} : { smsFrom }),
  };
};

/**
 * Supabase injects SUPABASE_DB_URL and SUPABASE_SERVICE_ROLE_KEY into every
 * Edge Function, but not a JWT secret, and this deployment has no way to add
 * one. Rather than invent a weak default, the signing key falls back to being
 * derived from the service role key — which is high-entropy, already secret,
 * and never leaves the function environment.
 *
 * The derivation itself lives in the token adapter, which runs HKDF over
 * whatever it is given, so the raw input is never the signing key in either
 * case. The consequence of the fallback is that rotating the service role key
 * invalidates every live session; the source is reported by /health so that is
 * visible rather than surprising.
 */
const signingSecretFrom = (
  env: Environment,
): { secret: string | undefined; source: Config["jwtSecretSource"] } => {
  const explicit = env["SUPABASE_JWT_SECRET"];
  if (explicit !== undefined && explicit.length > 0) {
    return { secret: explicit, source: "SUPABASE_JWT_SECRET" };
  }
  return {
    secret: env["SUPABASE_SERVICE_ROLE_KEY"],
    source: "SUPABASE_SERVICE_ROLE_KEY",
  };
};

export const loadConfig = (env: Environment): Config => {
  const signing = signingSecretFrom(env);
  const parsed = schema.safeParse({
    databaseUrl: env["SUPABASE_DB_URL"],
    jwtSecret: signing.secret,
    jwtSecretSource: signing.source,
    serviceRoleKey: env["SUPABASE_SERVICE_ROLE_KEY"] ?? null,
    verificationTransport: env["VERIFICATION_TRANSPORT"],
    notificationTransport: env["NOTIFICATION_TRANSPORT"],
    twilio: readTwilio(env),
    exposeVerificationCode: readBoolean(
      env["EXPOSE_VERIFICATION_CODE"],
      (env["VERIFICATION_TRANSPORT"] ?? "LOG") === "LOG",
    ),
    corsOrigins: (env["CORS_ORIGINS"] ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  });

  if (!parsed.success) {
    // Report the environment variable the operator has to set, not the field
    // name it happens to parse into.
    const problems = parsed.error.issues
      .map((issue) => {
        const field = String(issue.path[0] ?? "");
        const variable = ENVIRONMENT_VARIABLE[field] ?? (field || "configuration");
        return `${variable} ${issue.message.toLowerCase()}`;
      })
      .join("; ");
    throw new Error(`Invalid configuration — ${problems}`);
  }

  return assertCoherent(parsed.data);
};

/**
 * Settings that are individually valid but wrong together. Catching these at
 * boot is the difference between a misconfiguration and an incident.
 */
const assertCoherent = (config: Config): Config => {
  const needsTwilio =
    config.verificationTransport !== "LOG" ||
    config.notificationTransport !== "LOG";

  if (needsTwilio && config.twilio === null) {
    throw new Error(
      "A WhatsApp or SMS transport is selected but Twilio credentials are absent. " +
        "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM, or leave the transports on LOG.",
    );
  }

  if (config.exposeVerificationCode && config.verificationTransport !== "LOG") {
    throw new Error(
      "EXPOSE_VERIFICATION_CODE returns the code to the caller and is for development only. " +
        "It cannot be combined with a real verification transport.",
    );
  }

  if (config.notificationTransport === "SMS" && config.twilio?.smsFrom === undefined) {
    throw new Error("NOTIFICATION_TRANSPORT=SMS requires TWILIO_SMS_FROM.");
  }

  return config;
};
