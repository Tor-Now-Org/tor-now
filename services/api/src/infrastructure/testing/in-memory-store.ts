import type {
  Appointment,
  Block,
  Business,
  BusinessPhoto,
  DateOverride,
  Membership,
  MembershipResource,
  LocalDate,
  Notice,
  Payment,
  Grant,
  Instant,
  UsageRecord,
  Preview,
  Resource,
  Review,
  Service,
  Subscription,
  User,
  WorkingHours,
} from "@tor-now/domain";
import { addDays, asId, instant, microShekels, money, parseLocalDate, planTerms } from "@tor-now/domain";
import type { AuditEntry } from "../../ports/audit.ts";
import type { PlanEdition, UnitRateEntry, WaitingEntry, WaitingRecheck } from "../../ports/repositories.ts";
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
  /** The author's name is read from `users` on the way out, as the database joins it. */
  reviews: Omit<Review, "authorName">[];
  memberships: Membership[];
  membershipResources: MembershipResource[];
  resources: Resource[];
  services: Service[];
  workingHours: WorkingHours[];
  dateOverrides: DateOverride[];
  blocks: Block[];
  appointments: Appointment[];
  subscriptions: Subscription[];
  payments: Payment[];
  /** With the dedupe key the table keeps beside each. */
  notices: { notice: Notice; key: string | null }[];
  planVersions: PlanEdition[];
  previews: Preview[];
  usageRecords: UsageRecord[];
  unitRates: UnitRateEntry[];
  grants: (Grant & { createdAt: Instant })[];
  /** app_user.trial_taken_on, kept beside the User as the database keeps it. */
  trialsTaken: { userId: string; on: LocalDate }[];
  allowlist: { phone: string; note: string | null }[];
  waitingEntries: WaitingEntry[];
  waitingRechecks: (WaitingRecheck & { createdAt: number })[];
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

/** `today` is the day the Catalogue was seeded, as the migration's current_date. */
export const emptyStore = (
  today: LocalDate = parseLocalDate(new Date().toISOString().slice(0, 10)),
): Store => ({
  nextId: identifiers(),
  users: [],
  businesses: [],
  businessPhotos: [],
  reviews: [],
  memberships: [],
  membershipResources: [],
  resources: [],
  services: [],
  workingHours: [],
  dateOverrides: [],
  blocks: [],
  appointments: [],
  subscriptions: [],
  payments: [],
  notices: [],
  ...initialCatalogue(today),
  usageRecords: [],
  // The usage_records migration's default rates.
  unitRates: (["SMS_SEGMENT", "WHATSAPP_AUTHENTICATION", "WHATSAPP_UTILITY"] as const).map((unit) => ({
    unit,
    effectiveFrom: parseLocalDate("2026-09-01"),
    perUnit: microShekels(unit === "SMS_SEGMENT" ? 952_750 : 19_610),
    source: "Default",
    checkedBy: null,
    enteredAt: instant(0),
  })),
  grants: [],
  trialsTaken: [],
  allowlist: [],
  waitingEntries: [],
  waitingRechecks: [],
  audit: [],
  outbox: [],
  verificationCodes: [],
});

/**
 * The Catalogue the plans_and_entitlements migration seeds, so a test starts
 * from the same Plans and Preview the first deploy does.
 */
const initialCatalogue = (today: LocalDate): Pick<Store, "planVersions" | "previews"> => ({
  planVersions: [
    {
      id: asId("00005010-0000-4000-8000-000000000001"),
      plan: "SOLO",
      number: 1,
      terms: planTerms({ features: ["REMINDERS"], resourceAllowance: 1, price: money(4900) }),
      publishedAt: instant(0),
      withdrawnAt: null,
      firstMoveOn: null,
    },
    {
      id: asId("00007ea0-0000-4000-8000-000000000001"),
      plan: "TEAM",
      number: 1,
      terms: planTerms({
        features: ["REMINDERS", "CUSTOMER_HISTORY", "CUSTOMER_BLOCKING", "TEAM_ROLES"],
        resourceAllowance: 5,
        price: money(8900),
      }),
      publishedAt: instant(0),
      withdrawnAt: null,
      firstMoveOn: null,
    },
  ],
  previews: [{ feature: "WAITING_LIST", endsOn: addDays(today, 59) }],
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
