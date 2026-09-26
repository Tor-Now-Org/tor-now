import type { Instant } from "@tor-now/domain";
import type { DeliveryChannel } from "./notifier.ts";

/**
 * ADR 0004: proving control of a phone number is the platform's only
 * authentication mechanism. Registering, logging in and confirming a booking
 * are all the same act.
 *
 * ADR 0005 delivers the code over WhatsApp. The transport is a port so that
 * development runs with no vendor at all — `LogVerificationSender` is a
 * complete implementation, it simply delivers to the log.
 */
export type VerificationSender = {
  /** How it went out and how many billable units that took, so it can be costed. */
  send(phone: string, code: string): Promise<{ via: DeliveryChannel; units: number }>;
  /** Named so an operator can see which transport a deployment actually uses. */
  readonly channel: string;
};

export type VerificationCodeRecord = {
  readonly id: string;
  readonly phone: string;
  readonly codeHash: string;
  readonly expiresAt: Instant;
  readonly consumedAt: Instant | null;
  readonly attempts: number;
  readonly createdAt: Instant;
};

export type VerificationCodeRepository = {
  issue(record: {
    phone: string;
    codeHash: string;
    expiresAt: Instant;
  }): Promise<VerificationCodeRecord>;
  latestLiveFor(phone: string): Promise<VerificationCodeRecord | null>;
  countIssuedSince(phone: string, since: Instant): Promise<number>;
  recordAttempt(id: string): Promise<void>;
  consume(id: string): Promise<void>;
};

/** Hashing keeps a live credential out of a table the service_role can read. */
export type CodeHasher = {
  hash(phone: string, code: string): Promise<string>;
  verify(phone: string, code: string, hash: string): Promise<boolean>;
};

export type CodeGenerator = {
  generate(length: number): string;
};
