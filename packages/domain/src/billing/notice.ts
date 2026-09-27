import type { BusinessId, NoticeId } from "../model/ids.ts";
import { validationFailed } from "../shared/errors.ts";
import type { Instant } from "../time/instant.ts";
import { daysBetween, parseLocalDate, type LocalDate } from "../time/local-date.ts";
import type { GrantTerm } from "./entitlement.ts";
import { FEATURES, parseFeature, type Feature } from "./feature.ts";
import { PLANS, type Plan } from "./plan.ts";
import { graceEndsOn, subscriptionStateOn, type Subscription } from "./subscription.ts";

/**
 * A message from the platform to a Business about what its Subscription grants
 * or costs (docs/billing/CONTEXT.md). Every one is kept in the owner's list;
 * the ones that need a look also stand as a banner until acknowledged, and the
 * ones about paying also go out on WhatsApp (ADR 0020).
 *
 * A Notice holds the facts of what happened, not the sentence saying so: the
 * owner reads it in their own language, and WhatsApp in Hebrew, from the same
 * facts. Names of calendars are copied in as they were, so renaming one later
 * does not rewrite what the owner was told.
 */

export const NOTICE_KINDS = [
  "TRIAL_STARTED",
  "TRIAL_ENDING",
  "PAYMENT_LATE",
  "DEACTIVATED",
  "PAYMENT_RECORDED",
  "PLAN_CHANGED",
  "MOVE_SCHEDULED",
  "MOVE_SOON",
  "MOVE_APPLIED",
  "CALENDARS_PAUSED",
  "CALENDARS_RESUMED",
  "FEATURES_GRANTED",
  "GRANT_EXTENDED",
  "GRANT_ENDING",
  "GRANT_ENDED",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Who moved the Plan: the owner themselves, or an administrator for them. */
export type MovedBy = "OWNER" | "ADMINISTRATOR";

export type NoticeFacts =
  | { readonly kind: "TRIAL_STARTED"; readonly plan: Plan; readonly trialEndsOn: LocalDate }
  | { readonly kind: "TRIAL_ENDING"; readonly trialEndsOn: LocalDate }
  | { readonly kind: "PAYMENT_LATE"; readonly graceEndsOn: LocalDate }
  | { readonly kind: "DEACTIVATED"; readonly on: LocalDate }
  | { readonly kind: "PAYMENT_RECORDED"; readonly paidThrough: LocalDate }
  | {
      readonly kind: "PLAN_CHANGED";
      readonly plan: Plan;
      readonly by: MovedBy;
      /** The new price, owed from the next renewal. */
      readonly priceMinor: number;
      readonly resourceAllowance: number;
      readonly gained: readonly Feature[];
      readonly lost: readonly Feature[];
    }
  | {
      readonly kind: "MOVE_SCHEDULED";
      readonly plan: Plan;
      readonly by: MovedBy;
      readonly effectiveOn: LocalDate;
      /** The calendars that pause the day the move applies. */
      readonly pausing: readonly string[];
    }
  | {
      readonly kind: "MOVE_SOON";
      readonly plan: Plan;
      readonly effectiveOn: LocalDate;
      readonly pausing: readonly string[];
    }
  | { readonly kind: "MOVE_APPLIED"; readonly plan: Plan; readonly paused: readonly string[] }
  | { readonly kind: "CALENDARS_PAUSED"; readonly names: readonly string[]; readonly resourceAllowance: number }
  | { readonly kind: "CALENDARS_RESUMED"; readonly names: readonly string[] }
  /** Given together, so told together: one Notice however many Features. */
  | { readonly kind: "FEATURES_GRANTED"; readonly features: readonly Feature[]; readonly endsOn: LocalDate }
  | { readonly kind: "GRANT_EXTENDED"; readonly feature: Feature; readonly endsOn: LocalDate }
  | { readonly kind: "GRANT_ENDING"; readonly features: readonly Feature[]; readonly endsOn: LocalDate }
  | { readonly kind: "GRANT_ENDED"; readonly feature: Feature };

export type Notice = {
  readonly id: NoticeId;
  readonly businessId: BusinessId;
  readonly facts: NoticeFacts;
  readonly createdAt: Instant;
  /** When the owner opened the list with it in; null while unread. */
  readonly readAt: Instant | null;
  /**
   * When its banner stopped standing: the owner's "Got it", or what followed
   * making it moot — a payment ends "payment is late". Null while it stands.
   */
  readonly clearedAt: Instant | null;
};

/** How a Notice is drawn: the colour of what it says. */
export type NoticeTone = "good" | "info" | "caution" | "critical";

type KindRule = {
  readonly tone: NoticeTone;
  /** Whether it stands at the top of the screen until acknowledged. */
  readonly banner: boolean;
  /** Standing Notices this one makes moot. */
  readonly clears: readonly NoticeKind[];
};

const RULES: Readonly<Record<NoticeKind, KindRule>> = Object.freeze({
  TRIAL_STARTED: { tone: "good", banner: true, clears: [] },
  TRIAL_ENDING: { tone: "caution", banner: true, clears: ["TRIAL_STARTED"] },
  PAYMENT_LATE: { tone: "caution", banner: true, clears: [] },
  DEACTIVATED: {
    tone: "critical",
    banner: true,
    clears: ["TRIAL_STARTED", "TRIAL_ENDING", "PAYMENT_LATE"],
  },
  PAYMENT_RECORDED: {
    tone: "good",
    banner: false,
    clears: ["TRIAL_STARTED", "TRIAL_ENDING", "PAYMENT_LATE", "DEACTIVATED"],
  },
  PLAN_CHANGED: { tone: "info", banner: false, clears: ["MOVE_SOON"] },
  MOVE_SCHEDULED: { tone: "info", banner: false, clears: ["MOVE_SOON"] },
  MOVE_SOON: { tone: "caution", banner: true, clears: [] },
  MOVE_APPLIED: { tone: "info", banner: true, clears: ["MOVE_SOON"] },
  CALENDARS_PAUSED: { tone: "caution", banner: true, clears: ["CALENDARS_RESUMED"] },
  CALENDARS_RESUMED: { tone: "good", banner: true, clears: ["CALENDARS_PAUSED"] },
  FEATURES_GRANTED: { tone: "good", banner: true, clears: [] },
  GRANT_EXTENDED: { tone: "good", banner: false, clears: ["GRANT_ENDING"] },
  GRANT_ENDING: { tone: "caution", banner: true, clears: [] },
  GRANT_ENDED: { tone: "caution", banner: true, clears: ["FEATURES_GRANTED", "GRANT_ENDING"] },
});

export const noticeTone = (kind: NoticeKind): NoticeTone => RULES[kind].tone;
export const standsAsBanner = (kind: NoticeKind): boolean => RULES[kind].banner;
/**
 * What also goes to the owner on WhatsApp: only what is about paying. Each
 * message costs the platform, and the rest is news the owner either caused or
 * will see the next time they open the app.
 */
const ABOUT_PAYING = ["TRIAL_ENDING", "PAYMENT_LATE", "DEACTIVATED", "PAYMENT_RECORDED"] as const;
export type PaymentNoticeFacts = Extract<NoticeFacts, { kind: (typeof ABOUT_PAYING)[number] }>;

export const goesToWhatsApp = (kind: NoticeKind): boolean =>
  (ABOUT_PAYING as readonly NoticeKind[]).includes(kind);

export const isAboutPaying = (facts: NoticeFacts): facts is PaymentNoticeFacts => goesToWhatsApp(facts.kind);
export const noticesCleared = (kind: NoticeKind): readonly NoticeKind[] => RULES[kind].clears;

/**
 * What makes two Notices the same one, so a daily run that sees the same
 * situation again does not say it twice. Null for a Notice of an event, which
 * happens once by its nature.
 */
export const noticeKey = (facts: NoticeFacts): string | null => {
  switch (facts.kind) {
    case "TRIAL_STARTED":
      return "TRIAL_STARTED";
    case "TRIAL_ENDING":
      return `TRIAL_ENDING:${facts.trialEndsOn}`;
    case "PAYMENT_LATE":
      return `PAYMENT_LATE:${facts.graceEndsOn}`;
    case "DEACTIVATED":
      return `DEACTIVATED:${facts.on}`;
    case "MOVE_SOON":
      return `MOVE_SOON:${facts.plan}:${facts.effectiveOn}`;
    case "GRANT_ENDING":
      return `GRANT_ENDING:${facts.endsOn}:${[...facts.features].sort().join(",")}`;
    default:
      return null;
  }
};

/** The order banners take when more than one stands: what costs the most to miss first. */
const BANNER_ORDER: readonly NoticeKind[] = [
  "DEACTIVATED",
  "PAYMENT_LATE",
  "TRIAL_ENDING",
  "MOVE_SOON",
  "GRANT_ENDING",
  "CALENDARS_PAUSED",
  "GRANT_ENDED",
  "MOVE_APPLIED",
  "CALENDARS_RESUMED",
  "FEATURES_GRANTED",
  "TRIAL_STARTED",
];

export const isStanding = (notice: Notice): boolean =>
  standsAsBanner(notice.facts.kind) && notice.clearedAt === null;

/**
 * The one banner to show, and how many other unread Notices wait in the list.
 * One at a time, so the screen the owner came to use stays theirs.
 */
export const bannerOf = (
  notices: readonly Notice[],
): { readonly notice: Notice; readonly othersUnread: number } | null => {
  const standing = notices.filter(isStanding);
  if (standing.length === 0) return null;
  const rank = (notice: Notice) => BANNER_ORDER.indexOf(notice.facts.kind);
  const first = [...standing].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)[0];
  /* istanbul ignore next -- standing is not empty */
  if (first === undefined) return null;
  const othersUnread = notices.filter((notice) => notice.id !== first.id && notice.readAt === null).length;
  return { notice: first, othersUnread };
};

/** How far ahead a Trial's end or a scheduled move is announced. */
export const NOTICE_LEAD_DAYS = 7;

/**
 * What the daily run should say about one Business today, from its
 * Subscription alone. Saying the same thing again is harmless — `noticeKey`
 * makes it the same Notice — which is what lets a missed run catch up.
 */
export const noticesDue = (input: {
  readonly subscription: Pick<Subscription, "trialEndsOn" | "paidThrough" | "scheduledMove">;
  readonly scheduledPlan: Plan | null;
  /** The calendars marked to pause with the scheduled move. */
  readonly pausing: readonly string[];
  /** The Business's Grants; those ending within the week are announced. */
  readonly grants: readonly GrantTerm[];
  readonly businessActive: boolean;
  readonly today: LocalDate;
}): readonly NoticeFacts[] => {
  if (!input.businessActive) return [];
  const { subscription, today } = input;
  const state = subscriptionStateOn(subscription, today);
  const within = (date: LocalDate, from: number) => {
    const days = daysBetween(today, date);
    return days >= from && days <= NOTICE_LEAD_DAYS;
  };
  const due: NoticeFacts[] = [];
  if (state === "TRIAL" && subscription.trialEndsOn !== null && within(subscription.trialEndsOn, 0)) {
    due.push({ kind: "TRIAL_ENDING", trialEndsOn: subscription.trialEndsOn });
  }
  if (state === "IN_GRACE" && subscription.paidThrough !== null) {
    due.push({ kind: "PAYMENT_LATE", graceEndsOn: graceEndsOn({ paidThrough: subscription.paidThrough }) });
  }
  const move = subscription.scheduledMove;
  if (move !== null && input.scheduledPlan !== null && within(move.effectiveOn, 1)) {
    due.push({
      kind: "MOVE_SOON",
      plan: input.scheduledPlan,
      effectiveOn: move.effectiveOn,
      pausing: input.pausing,
    });
  }
  // One reminder per day Grants end, naming everything that ends that day.
  const ending = input.grants.filter((grant) => within(grant.endsOn, 0));
  const days = [...new Set(ending.map((grant) => grant.endsOn))].sort();
  for (const endsOn of days) {
    const features = FEATURES.filter((feature) =>
      ending.some((grant) => grant.endsOn === endsOn && grant.feature === feature),
    );
    due.push({ kind: "GRANT_ENDING", features, endsOn });
  }
  return due;
};

// -----------------------------------------------------------------------------
// Reading facts back. They are stored as JSON, and what comes back from storage
// is checked rather than trusted: a Notice that cannot be read is a bug to hear
// about, not a sentence to render with holes in it.
// -----------------------------------------------------------------------------

type Fields = Readonly<Record<string, unknown>>;

const field = (facts: Fields, name: string): unknown => {
  const value = facts[name];
  if (value === undefined) throw validationFailed(`A Notice is missing "${name}"`);
  return value;
};

const textOf = (facts: Fields, name: string): string => {
  const value = field(facts, name);
  if (typeof value !== "string") throw validationFailed(`A Notice's "${name}" is not text`);
  return value;
};

const dateOf = (facts: Fields, name: string): LocalDate => parseLocalDate(textOf(facts, name));

const countOf = (facts: Fields, name: string): number => {
  const value = field(facts, name);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw validationFailed(`A Notice's "${name}" is not a count`);
  }
  return value;
};

const planOf = (facts: Fields): Plan => {
  const value = textOf(facts, "plan");
  if (!(PLANS as readonly string[]).includes(value)) throw validationFailed(`Unknown plan "${value}"`);
  return value as Plan;
};

const byOf = (facts: Fields): MovedBy => {
  const value = textOf(facts, "by");
  if (value !== "OWNER" && value !== "ADMINISTRATOR") throw validationFailed(`Unknown mover "${value}"`);
  return value;
};

const textsOf = (facts: Fields, name: string): readonly string[] => {
  const value = field(facts, name);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw validationFailed(`A Notice's "${name}" is not a list of names`);
  }
  return value as string[];
};

const featuresOf = (facts: Fields, name: string): readonly Feature[] => textsOf(facts, name).map(parseFeature);

export const parseNoticeFacts = (value: unknown): NoticeFacts => {
  if (typeof value !== "object" || value === null) throw validationFailed("A Notice's facts are not an object");
  const facts = value as Fields;
  const kind = textOf(facts, "kind");
  switch (kind) {
    case "TRIAL_STARTED":
      return { kind, plan: planOf(facts), trialEndsOn: dateOf(facts, "trialEndsOn") };
    case "TRIAL_ENDING":
      return { kind, trialEndsOn: dateOf(facts, "trialEndsOn") };
    case "PAYMENT_LATE":
      return { kind, graceEndsOn: dateOf(facts, "graceEndsOn") };
    case "DEACTIVATED":
      return { kind, on: dateOf(facts, "on") };
    case "PAYMENT_RECORDED":
      return { kind, paidThrough: dateOf(facts, "paidThrough") };
    case "PLAN_CHANGED":
      return {
        kind,
        plan: planOf(facts),
        by: byOf(facts),
        priceMinor: countOf(facts, "priceMinor"),
        resourceAllowance: countOf(facts, "resourceAllowance"),
        gained: featuresOf(facts, "gained"),
        lost: featuresOf(facts, "lost"),
      };
    case "MOVE_SCHEDULED":
      return {
        kind,
        plan: planOf(facts),
        by: byOf(facts),
        effectiveOn: dateOf(facts, "effectiveOn"),
        pausing: textsOf(facts, "pausing"),
      };
    case "MOVE_SOON":
      return { kind, plan: planOf(facts), effectiveOn: dateOf(facts, "effectiveOn"), pausing: textsOf(facts, "pausing") };
    case "MOVE_APPLIED":
      return { kind, plan: planOf(facts), paused: textsOf(facts, "paused") };
    case "CALENDARS_PAUSED":
      return { kind, names: textsOf(facts, "names"), resourceAllowance: countOf(facts, "resourceAllowance") };
    case "CALENDARS_RESUMED":
      return { kind, names: textsOf(facts, "names") };
    case "FEATURES_GRANTED":
    case "GRANT_ENDING":
      return { kind, features: featuresOf(facts, "features"), endsOn: dateOf(facts, "endsOn") };
    case "GRANT_EXTENDED":
      return { kind, feature: parseFeature(textOf(facts, "feature")), endsOn: dateOf(facts, "endsOn") };
    case "GRANT_ENDED":
      return { kind, feature: parseFeature(textOf(facts, "feature")) };
    default:
      throw validationFailed(`Unknown kind of Notice "${kind}"`);
  }
};
