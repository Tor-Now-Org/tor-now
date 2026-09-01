import {
  greedyWalk,
  instant,
  parseInstant,
  type Clock,
  type Instant,
} from "@tor-now/domain";
import { adminService } from "../../application/admin-service.ts";
import { authService, profileService } from "../../application/auth-service.ts";
import { availabilityService } from "../../application/availability-service.ts";
import { bookingService } from "../../application/booking-service.ts";
import { businessService } from "../../application/business-service.ts";
import { calendarService } from "../../application/calendar-service.ts";
import { discoveryService } from "../../application/discovery-service.ts";
import { outboxWorker } from "../../application/outbox-worker.ts";
import { reminderService } from "../../application/reminder-service.ts";
import type { AuditLogEntry, AuditReader, AuditSink } from "../../ports/audit.ts";
import type { Notifier, Outbox } from "../../ports/notifier.ts";
import type { TokenIssuer, TokenVerifier } from "../../ports/tokens.ts";
import { actorUserId, type Session, type UnitOfWork } from "../../ports/unit-of-work.ts";
import type {
  CodeGenerator,
  VerificationCodeRepository,
  VerificationSender,
} from "../../ports/verification.ts";
import { withAuditing } from "../auditing.ts";
import { inFunctionPhotos } from "../photos/in-function-photos.ts";
import { sha256Hasher } from "../verification/code.ts";
import { inMemoryRepositories } from "./in-memory-repositories.ts";
import { emptyStore, type Store } from "./in-memory-store.ts";

/**
 * A whole application, wired to memory instead of Postgres.
 *
 * The composition mirrors the real root exactly — same services, same auditing
 * decorator, same strategy — so these tests exercise the wiring as well as the
 * services. Only the adapters differ, which is the point of having ports.
 */

export const FROZEN_NOW: Instant = parseInstant("2026-08-25T09:00:00.000Z");

export type Harness = ReturnType<typeof harness>;

export const harness = (options: { now?: Instant } = {}) => {
  const store: Store = emptyStore();

  // Time moves, so the clock has to. A test that books ahead of the minimum
  // notice and then cancels inside the cancellation window needs both moments,
  // and freezing one of them makes that scenario unreachable.
  let currentTime: Instant = options.now ?? FROZEN_NOW;
  const clock: Clock = { now: () => currentTime };

  // The same store production falls back to, so a test exercises the real
  // ordering — bytes first, row second — rather than a stub of it.
  const photos = inFunctionPhotos();

  const audit: AuditSink = {
    async append(entry) {
      store.audit = [...store.audit, { ...entry, occurredAt: clock.now() }];
    },
  };

  const auditTrail: AuditReader = {
    async recent(limit, offset): Promise<readonly AuditLogEntry[]> {
      return [...store.audit]
        .reverse()
        .slice(offset, offset + limit)
        .map((entry, index) => ({
          ...entry,
          id: String(index),
          occurredAt: instant(entry.occurredAt),
        }));
    },
  };

  const outbox: Outbox = {
    async enqueue(message) {
      store.outbox = [
        ...store.outbox,
        {
          id: String(store.outbox.length + 1),
          message,
          attempts: 0,
          status: "PENDING",
          via: null,
        },
      ];
    },
    async claimPending(limit) {
      return store.outbox
        .filter((entry) => entry.status === "PENDING")
        .slice(0, limit)
        .map((entry) => ({
          id: entry.id,
          message: entry.message,
          attempts: entry.attempts,
          createdAt: clock.now(),
        }));
    },
    async markSent(id, via) {
      store.outbox = store.outbox.map((entry) =>
        entry.id === id ? { ...entry, status: "SENT", via, attempts: entry.attempts + 1 } : entry,
      );
    },
    async markFailed(id, _reason, giveUp) {
      store.outbox = store.outbox.map((entry) =>
        entry.id === id
          ? { ...entry, status: giveUp ? "FAILED" : "PENDING", attempts: entry.attempts + 1 }
          : entry,
      );
    },
  };

  const unitOfWork: UnitOfWork = {
    async run(actor, work) {
      const session: Session = {
        repositories: withAuditing(inMemoryRepositories(store), {
          sink: audit,
          actorId: actorUserId(actor),
        }),
        audit,
        auditTrail,
        outbox,
      };
      return work(session);
    },
  };

  // A fixed code, so a test can sign someone in without reading it back.
  const generator: CodeGenerator = { generate: (length) => "1".repeat(length) };

  const sent: { phone: string; code: string }[] = [];
  const sender: VerificationSender = {
    channel: "TEST",
    async send(phone, code) {
      sent.push({ phone, code });
    },
  };

  const codes: VerificationCodeRepository = {
    async issue({ phone, codeHash, expiresAt }) {
      const record = {
        id: String(store.verificationCodes.length + 1),
        phone,
        codeHash,
        expiresAt,
        consumedAt: null,
        attempts: 0,
        createdAt: clock.now(),
      };
      store.verificationCodes = [...store.verificationCodes, record];
      return record;
    },
    async latestLiveFor(phone) {
      return (
        [...store.verificationCodes]
          .reverse()
          .find(
            (record) =>
              record.phone === phone &&
              record.consumedAt === null &&
              record.expiresAt > clock.now(),
          ) ?? null
      );
    },
    async countIssuedSince(phone, since) {
      return store.verificationCodes.filter(
        (record) => record.phone === phone && record.createdAt >= since,
      ).length;
    },
    async recordAttempt(id) {
      store.verificationCodes = store.verificationCodes.map((record) =>
        record.id === id ? { ...record, attempts: record.attempts + 1 } : record,
      );
    },
    async consume(id) {
      store.verificationCodes = store.verificationCodes.map((record) =>
        record.id === id ? { ...record, consumedAt: clock.now() } : record,
      );
    },
  };

  // Tokens are opaque to the application; the tests only need them to round
  // trip, so the harness signs nothing and simply encodes the claims.
  const issued = new Map<string, { userId: string; phone: string; isAdministrator: boolean }>();
  const tokens: TokenIssuer = {
    async issue(claims) {
      const token = `test-token-${issued.size + 1}`;
      issued.set(token, { ...claims });
      return token;
    },
  };
  const verifier: TokenVerifier = {
    async verify(token) {
      const claims = issued.get(token);
      return claims === undefined ? null : (claims as never);
    },
  };

  const delivered: string[] = [];
  const notifier: Notifier = {
    async deliver(message) {
      delivered.push(message.template);
      return { delivered: true, via: "LOG" };
    },
  };

  const admin = adminService({ unitOfWork, clock });
  const availability = availabilityService({ unitOfWork, clock, strategy: greedyWalk });

  return {
    store,
    clock,
    /** Moves the harness's clock, so a later moment can be tested. */
    travelTo: (moment: Instant) => {
      currentTime = moment;
    },
    sentCodes: sent,
    deliveredTemplates: delivered,
    tokens: verifier,
    photos,
    services: {
      auth: authService({
        unitOfWork,
        codes,
        sender,
        hasher: sha256Hasher,
        generator,
        tokens,
        clock,
        exposeCode: true,
      }),
      profile: profileService({ unitOfWork }),
      discovery: discoveryService({ unitOfWork, clock, strategy: greedyWalk }),
      availability,
      booking: bookingService({ unitOfWork, clock, strategy: greedyWalk }),
      business: businessService({ unitOfWork, clock, photos }),
      calendar: calendarService({ unitOfWork }),
      admin,
      outboxWorker: outboxWorker({ unitOfWork, notifier }),
      reminders: reminderService({ unitOfWork, clock }),
    },
  };
};

/** Signs a phone in through the real flow and returns the actor for it. */
export const signIn = async (
  test: Harness,
  phone: string,
  name: string | null = "Tester",
) => {
  await test.services.auth.requestCode(phone);
  // Tests name people the way people are usually named: one word, or two.
  const [givenName, ...rest] = (name ?? "").split(" ").filter((part) => part !== "");
  const result = await test.services.auth.verifyCode(
    phone,
    "111111",
    givenName === undefined
      ? null
      : { givenName, familyName: rest.length === 0 ? null : rest.join(" ") },
  );
  return {
    token: result.token,
    user: result.user,
    actor: { kind: "USER" as const, userId: result.user.id },
    administrator: { kind: "ADMINISTRATOR" as const, userId: result.user.id },
  };
};
