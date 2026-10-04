import { greedyWalk, systemClock, type Clock } from "@tor-now/domain";
import { loadConfig, PHOTOS, type Config, type Environment } from "./config.ts";
import { adminService } from "./application/admin-service.ts";
import { authService, profileService } from "./application/auth-service.ts";
import { availabilityService } from "./application/availability-service.ts";
import { bookingService } from "./application/booking-service.ts";
import { businessService } from "./application/business-service.ts";
import { calendarService } from "./application/calendar-service.ts";
import { closureService } from "./application/closure-service.ts";
import { changeService } from "./application/change-service.ts";
import { catalogueService } from "./application/catalogue-service.ts";
import { catalogueAdminService } from "./application/catalogue-admin.ts";
import { planCatalogueService } from "./application/plan-catalogue.ts";
import { featureCatalogueService } from "./application/feature-catalogue.ts";
import { addonCatalogueService } from "./application/addon-catalogue.ts";
import { costService } from "./application/cost-service.ts";
import { fairUseService } from "./application/fair-use-service.ts";
import { addonService } from "./application/addon-service.ts";
import { discoveryService } from "./application/discovery-service.ts";
import { reviewService } from "./application/review-service.ts";
import { statisticsService } from "./application/statistics-service.ts";
import { noticeService } from "./application/notice-service.ts";
import { outboxWorker } from "./application/outbox-worker.ts";
import { reminderService } from "./application/reminder-service.ts";
import { waitingService } from "./application/waiting-service.ts";
import { pruneAuditLog } from "./application/retention-service.ts";
import { measureDatabase } from "./http/diagnostics.ts";
import { createPool, type Sql } from "./infrastructure/pg/client.ts";
import { postgresUnitOfWork } from "./infrastructure/pg/unit-of-work.ts";
import { jobCredential } from "./infrastructure/pg/job-credential.ts";
import { verificationCodeRepository } from "./infrastructure/pg/verification-repository.ts";
import { logNotifier } from "./infrastructure/notifier/log-notifier.ts";
import { inFunctionPhotos } from "./infrastructure/photos/in-function-photos.ts";
import { supabaseStoragePhotos } from "./infrastructure/photos/supabase-storage.ts";
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
    return logNotifier(undefined, config.webOrigin);
  }
  return twilioNotifier(config.twilio, config.webOrigin);
};

const verificationSenderFor = (config: Config): VerificationSender => {
  if (config.verificationTransport === "LOG" || config.twilio === null) {
    return logVerificationSender();
  }
  return twilioVerificationSender(config.twilio, config.verificationTransport);
};

/**
 * Storage when there is a Supabase behind the deployment, and the function's
 * own memory when there is not — the same shape as the notifier, and for the
 * same reason: the whole path should be exercisable without the vendor.
 */
const photoStoreFor = (config: Config) =>
  config.storage === null
    ? inFunctionPhotos()
    : supabaseStoragePhotos({ ...config.storage, bucket: PHOTOS.bucket });

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
  const photos = photoStoreFor(config);

  const admin = adminService({ unitOfWork, clock });
  const featureCatalogue = featureCatalogueService({ unitOfWork, clock });
  // ADR 0001: the strategy is named here, so replacing it is a wiring change.
  const availability = availabilityService({ unitOfWork, clock, strategy: greedyWalk });

  const services = {
    config,
    tokens,
    photos,
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
    catalogue: catalogueService({ unitOfWork }),
    discovery: discoveryService({ unitOfWork, clock, strategy: greedyWalk }),
    reviews: reviewService({ unitOfWork, clock }),
    availability,
    booking: bookingService({ unitOfWork, clock, strategy: greedyWalk }),
    business: businessService({ unitOfWork, clock, photos }),
    calendar: calendarService({ unitOfWork, clock }),
    statistics: statisticsService({ unitOfWork, clock }),
    notices: noticeService({ unitOfWork, clock }),
    catalogueAdmin: catalogueAdminService({ unitOfWork, clock }),
    planCatalogue: planCatalogueService({ unitOfWork, clock }),
    featureCatalogue,
    addonCatalogue: addonCatalogueService({ unitOfWork, clock }),
    costs: costService({ unitOfWork, clock }),
    fairUse: fairUseService({ unitOfWork, clock }),
    addons: addonService({ unitOfWork, clock }),
    closures: closureService({ unitOfWork, clock }),
    changes: changeService({ unitOfWork, clock }),
    admin,

    outboxWorker: outboxWorker({ unitOfWork, notifier, clock }),
    reminders: reminderService({ unitOfWork, clock }),
    waiting: waitingService({ unitOfWork, clock, strategy: greedyWalk }),
    measureDatabase: () => measureDatabase(sql),
    pruneAuditLog: () => pruneAuditLog(sql),
    deactivateLapsedBusinesses: () => admin.deactivateLapsedBusinesses(system()),
    applyDueMoves: () => admin.applyDueMoves(system()),
    announceDueNotices: () => admin.announceDueNotices(system()),
    stretchUndecidedPreviews: () => featureCatalogue.stretchUndecidedPreviews(system()),
  };

  return { services, sql, config };
};
