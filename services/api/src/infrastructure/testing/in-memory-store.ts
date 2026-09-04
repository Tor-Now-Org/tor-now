import type {
  Appointment,
  Block,
  Business,
  BusinessPhoto,
  DateOverride,
  Membership,
  Payment,
  Resource,
  Service,
  Subscription,
  User,
  WorkingHours,
} from "@tor-now/domain";
import type { AuditEntry } from "../../ports/audit.ts";
import type { OutboundMessage } from "../../ports/notifier.ts";
import type { VerificationCodeRecord } from "../../ports/verification.ts";

/**
 * Everything the in-memory repositories hold, in one place, so a test can look
 * at what a service actually wrote rather than inferring it from what the
 * service returned.
 */
export type NextId = (prefix: string) => string;

export type Store = {
  /**
   * Shared by every repository instance. The unit of work builds a fresh set of
   * repositories per call, so a counter owned by the repositories would restart
   * on each one and hand out the same id twice.
   */
  nextId: NextId;
  users: User[];
  businesses: Business[];
  businessPhotos: BusinessPhoto[];
  memberships: Membership[];
  resources: Resource[];
  services: Service[];
  workingHours: WorkingHours[];
  dateOverrides: DateOverride[];
  blocks: Block[];
  appointments: Appointment[];
  subscriptions: Subscription[];
  payments: Payment[];
  allowlist: { phone: string; note: string | null }[];
  audit: (AuditEntry & { occurredAt: number })[];
  outbox: {
    id: string;
    message: OutboundMessage;
    attempts: number;
    status: string;
    via: string | null;
    /** When a failed message may be tried again; null when it never failed. */
    retryAfter: number | null;
  }[];
  verificationCodes: VerificationCodeRecord[];
};

export const emptyStore = (): Store => ({
  nextId: identifiers(),
  users: [],
  businesses: [],
  businessPhotos: [],
  memberships: [],
  resources: [],
  services: [],
  workingHours: [],
  dateOverrides: [],
  blocks: [],
  appointments: [],
  subscriptions: [],
  payments: [],
  allowlist: [],
  audit: [],
  outbox: [],
  verificationCodes: [],
});

/**
 * Identifiers are the database's job in production, where they are UUIDs — and
 * the HTTP layer validates them as UUIDs, so the double has to issue the same
 * shape or it would pass tests the real system fails.
 *
 * They stay deterministic and carry the entity name in the first block, so a
 * failure message still says which kind of thing an id belongs to.
 */
export const identifiers = (): NextId => {
  let next = 0;
  return (prefix: string): string => {
    next += 1;
    const label = [...prefix]
      .reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7)
      .toString(16)
      .padStart(8, "0")
      .slice(0, 8);
    const counter = String(next).padStart(12, "0");
    return `${label}-0000-4000-8000-${counter}`;
  };
};
