import { greedyWalk, systemClock, type Clock } from "@tor-now/domain";
import { loadConfig, type Config, type Environment } from "./config.ts";
import { adminService } from "./application/admin-service.ts";
import { authService, profileService } from "./application/auth-service.ts";
import { availabilityService } from "./application/availability-service.ts";
import { bookingService } from "./application/booking-service.ts";
import { businessService } from "./application/business-service.ts";
import { calendarService } from "./application/calendar-service.ts";
import { discoveryService } from "./application/discovery-service.ts";
import { outboxWorker } from "./application/outbox-worker.ts";
import { reminderService } from "./application/reminder-service.ts";
import { pruneAuditLog } from "./application/retention-service.ts";
import { measureDatabase } from "./http/diagnostics.ts";
import { createPool, type Sql } from "./infrastructure/pg/client.ts";
import { postgresUnitOfWork } from "./infrastructure/pg/unit-of-work.ts";
import { jobCredential } from "./infrastructure/pg/job-credential.ts";
import { verificationCodeRepository } from "./infrastructure/pg/verification-repository.ts";
import { logNotifier } from "./infrastructure/notifier/log-notifier.ts";
import { twilioNotifier } from "./infrastructure/notifier/twilio-notifier.ts";
import { randomDigitsGenerator, sha256Hasher } from "./infrastructure/verification/code.ts";
import {
  logVerificationSender,
  twilioVerificationSender,
} from "./infrastructure/verification/senders.ts";
import { jwtIssuer, jwtVerifier } from "./infrastructure/tokens/jwt.ts";
import type { Notifier } from "./ports/notifier.ts";
import type { TokenVerifier } from "./ports/tokens.ts";
import type { VerificationSender } from "./ports/verification.ts";
import { system } from "./ports/unit-of-work.ts";

/**
 * ADR 0007 replaces NestJS with Hono and an explicit composition root. This is
 * that root: the only place that knows which adapter sits behind which port,
 * and therefore the only place that changes when one is swapped.
 *
 * Everything above this file depends on interfaces. Nothing above it can tell
 * whether a message went to WhatsApp or to a log.
 */

export type Services = ReturnType<typeof compose>["services"];

/**
 * ADR 0005's swappable adapters, chosen by configuration. `assertCoherent` has
 * already refused a transport whose credentials are absent, so the fallbacks
 * here are exhaustiveness rather than leniency.
 */
const notifierFor = (config: Config): Notifier => {
  if (config.notificationTransport === "LOG" || config.twilio === null) {
    return logNotifier();
  }
  return twilioNotifier(config.twilio);
};

const verificationSenderFor = (config: Config): VerificationSender => {
  if (config.verificationTransport === "LOG" || config.twilio === null) {
    return logVerificationSender();
  }
  return twilioVerificationSender(config.twilio, config.verificationTransport);
};

export const compose = (
  environment: Environment,
  overrides: { clock?: Clock; sql?: Sql } = {},
) => {
  const config = loadConfig(environment);
  const sql = overrides.sql ?? createPool(config.databaseUrl);
  const clock = overrides.clock ?? systemClock;

  const unitOfWork = postgresUnitOfWork(sql);
  const tokens: TokenVerifier = jwtVerifier(config.jwtSecret);
  const notifier = notifierFor(config);

  const admin = adminService({ unitOfWork, clock });
  // ADR 0001: the strategy is named here, so replacing it is a wiring change.
  const availability = availabilityService({ unitOfWork, clock, strategy: greedyWalk });

  const services = {
    config,
    tokens,
    jobCredential: jobCredential(sql),

    auth: authService({
      unitOfWork,
      // The verification table carries no RLS policy by design, so its
      // repository runs on the pool rather than inside a caller's transaction.
      codes: verificationCodeRepository(sql),
      sender: verificationSenderFor(config),
      hasher: sha256Hasher,
      generator: randomDigitsGenerator,
      tokens: jwtIssuer(config.jwtSecret),
      clock,
      exposeCode: config.exposeVerificationCode,
    }),

    profile: profileService({ unitOfWork }),
    discovery: discoveryService({ unitOfWork, clock, strategy: greedyWalk }),
    availability,
    booking: bookingService({ unitOfWork, clock, strategy: greedyWalk }),
    business: businessService({ unitOfWork, clock }),
    calendar: calendarService({ unitOfWork }),
    admin,

    outboxWorker: outboxWorker({ unitOfWork, notifier }),
    reminders: reminderService({ unitOfWork, clock }),
    measureDatabase: () => measureDatabase(sql),
    pruneAuditLog: () => pruneAuditLog(sql),
    deactivateLapsedBusinesses: () => admin.deactivateLapsedBusinesses(system()),
  };

  return { services, sql, config };
};
