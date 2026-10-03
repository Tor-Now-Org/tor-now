import { daysBetween, parseLocalDate, TRIAL_DAYS, type NoticeFacts } from "@tor-now/domain";
import type { FeatureName, NoticeDto, PlanName } from "@/lib/api/types.ts";
import type { DICTIONARIES, Language } from "@/lib/i18n/dictionaries.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { localDateOf } from "@/components/owner/day-filter.ts";

/**
 * A Notice in the owner's words (ADR 0020). The API sends what happened as
 * facts; this is the one place those facts become a sentence, so the bell's
 * list, the banner and every test read a Notice the same way. Pure: today and
 * the language come in, nothing is read from the clock.
 */

export type NoticeAction = "PAY" | "PLANS" | "CANCEL_MOVE" | "INCLUDED";

export type NoticeText = {
  readonly title: string;
  readonly body: string;
  readonly action: NoticeAction | null;
};

type Words = (typeof DICTIONARIES)["notices"]["he"];
type BillingWords = (typeof DICTIONARIES)["billing"]["he"];

export type NoticeContext = {
  readonly words: Words;
  readonly billing: BillingWords;
  readonly language: Language;
  /** The Business's own today, as YYYY-MM-DD. */
  readonly today: string;
};

const sentences = (...parts: readonly (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" ");

/** Calendar names as a sentence joins them: "Dana and Yossi". */
const namesOf = (names: readonly string[], language: Language): string =>
  new Intl.ListFormat(language === "he" ? "he-IL" : "en-GB", { type: "conjunction" }).format(names);

/** A coming day relative to today, or null once it has passed. */
const whenOf = (date: string, context: NoticeContext): string | null => {
  const days = daysBetween(parseLocalDate(context.today), parseLocalDate(date));
  if (days < 0) return null;
  if (days === 0) return context.words.today;
  if (days === 1) return context.words.tomorrow;
  return fillText(context.words.inDays, { n: String(days) });
};

/** In the middle of a sentence, where the billing panel's labels would be capitalised. */
const calendarsOf = (allowance: number, words: Words): string =>
  allowance === 1 ? words.oneCalendar : fillText(words.upToCalendars, { n: String(allowance) });

/** What a Plan's change does, as one sentence: the price, the calendars, then the Features. */
const changesOf = (
  facts: {
    priceFrom: number;
    priceTo: number;
    allowanceFrom: number;
    allowanceTo: number;
    gained: readonly FeatureName[];
    lost: readonly FeatureName[];
  },
  context: NoticeContext,
  named: (list: readonly FeatureName[]) => string,
): string => {
  const { words, language } = context;
  const price = (minor: number) => formatPrice(minor, language, "—");
  const parts = [
    ...(facts.priceTo === facts.priceFrom
      ? []
      : [
          fillText(facts.priceTo > facts.priceFrom ? words.priceRises : words.priceFalls, {
            from: price(facts.priceFrom),
            to: price(facts.priceTo),
          }),
        ]),
    ...(facts.allowanceTo === facts.allowanceFrom
      ? []
      : [fillText(words.calendarsChange, { from: String(facts.allowanceFrom), to: String(facts.allowanceTo) })]),
    ...(facts.lost.length === 0 ? [] : [fillText(words.noLongerIncluded, { list: named(facts.lost) })]),
    ...(facts.gained.length === 0 ? [] : [fillText(words.nowIncluded, { list: named(facts.gained) })]),
  ];
  const joined = namesOf(parts, language);
  return joined.charAt(0).toLocaleUpperCase(language === "he" ? "he-IL" : "en-GB") + joined.slice(1);
};

export const noticeText = (facts: NoticeFacts, context: NoticeContext): NoticeText => {
  const { words, billing, language } = context;
  const date = (value: string) => formatLocalDate(value, language);
  const money = (minor: number) => formatPrice(minor, language, "—");
  const plan = (value: PlanName) => billing.plan[value];
  const features = (list: readonly FeatureName[]) =>
    namesOf(list.map((feature) => billing.featureLine[feature]), language);
  /** Short names, for a title or a list of what was given. */
  const named = (list: readonly FeatureName[]) => namesOf(list.map((feature) => billing.featureName[feature]), language);

  switch (facts.kind) {
    case "TRIAL_STARTED":
      return {
        title: words.trialStartedTitle,
        body: fillText(words.trialStartedBody, {
          days: String(TRIAL_DAYS),
          plan: plan(facts.plan),
          date: date(facts.trialEndsOn),
        }),
        action: "PLANS",
      };
    case "TRIAL_ENDING": {
      const when = whenOf(facts.trialEndsOn, context);
      return {
        title: when === null ? words.trialEndedTitle : fillText(words.trialEndingTitle, { when }),
        body: fillText(words.trialEndingBody, { date: date(facts.trialEndsOn) }),
        action: "PAY",
      };
    }
    case "PAYMENT_LATE":
      return {
        title: words.paymentLateTitle,
        body: fillText(words.paymentLateBody, { date: date(facts.graceEndsOn) }),
        action: "PAY",
      };
    case "PAYMENT_DUE":
      return {
        title: words.paymentDueTitle,
        body: fillText(words.paymentDueBody, { date: date(facts.deactivatesOn), time: facts.at }),
        action: null,
      };
    case "DEACTIVATED":
      return { title: words.deactivatedTitle, body: words.deactivatedBody, action: "PAY" };
    case "PAYMENT_RECORDED":
      return {
        title: words.paymentRecordedTitle,
        body: fillText(words.paymentRecordedBody, { date: date(facts.paidThrough) }),
        action: null,
      };
    case "PLAN_CHANGED":
      return {
        title: fillText(facts.by === "OWNER" ? words.planChangedTitle : words.planChangedByUsTitle, {
          plan: plan(facts.plan),
        }),
        body: sentences(
          fillText(words.planChangedCalendars, { calendars: calendarsOf(facts.resourceAllowance, words) }),
          facts.gained.length === 0 ? null : fillText(words.planChangedGained, { list: features(facts.gained) }),
          facts.lost.length === 0 ? null : fillText(words.planChangedLost, { list: features(facts.lost) }),
          fillText(words.planChangedPrice, { price: formatPrice(facts.priceMinor, language, "—") }),
        ),
        action: null,
      };
    case "MOVE_SCHEDULED":
      return {
        title: fillText(facts.by === "OWNER" ? words.moveScheduledTitle : words.moveScheduledByUsTitle, {
          plan: plan(facts.plan),
        }),
        body: sentences(
          fillText(words.moveScheduledBody, { date: date(facts.effectiveOn) }),
          facts.pausing.length === 0 ? null : fillText(words.willPause, { names: namesOf(facts.pausing, language) }),
        ),
        action: "CANCEL_MOVE",
      };
    case "MOVE_SOON":
      return {
        title: fillText(words.moveSoonTitle, {
          plan: plan(facts.plan),
          when: whenOf(facts.effectiveOn, context) ?? date(facts.effectiveOn),
        }),
        body: sentences(
          fillText(words.moveSoonBody, { date: date(facts.effectiveOn) }),
          facts.pausing.length === 0 ? null : fillText(words.willPause, { names: namesOf(facts.pausing, language) }),
        ),
        action: "CANCEL_MOVE",
      };
    case "MOVE_APPLIED":
      return {
        title: fillText(words.moveAppliedTitle, { plan: plan(facts.plan) }),
        body: sentences(
          words.moveAppliedBody,
          facts.paused.length === 0 ? null : fillText(words.movePausedBody, { names: namesOf(facts.paused, language) }),
        ),
        action: facts.paused.length === 0 ? null : "PLANS",
      };
    case "CALENDARS_PAUSED": {
      const names = namesOf(facts.names, language);
      return {
        title:
          facts.names.length === 1
            ? fillText(words.pausedTitleOne, { names })
            : fillText(words.pausedTitleMany, { n: String(facts.names.length) }),
        body: fillText(words.pausedBody, { names, calendars: calendarsOf(facts.resourceAllowance, words) }),
        action: "PLANS",
      };
    }
    case "CALENDARS_RESUMED": {
      const names = namesOf(facts.names, language);
      return {
        title: facts.names.length === 1 ? fillText(words.resumedTitleOne, { names }) : words.resumedTitleMany,
        body: fillText(words.resumedBody, { names }),
        action: null,
      };
    }
    case "FEATURES_GRANTED":
      return {
        title:
          facts.features.length === 1
            ? fillText(words.grantedTitleOne, { feature: named(facts.features) })
            : fillText(words.grantedTitleMany, { n: String(facts.features.length) }),
        body: fillText(words.grantedBody, { list: named(facts.features), date: date(facts.endsOn) }),
        action: "INCLUDED",
      };
    case "GRANT_EXTENDED":
      return {
        title: fillText(words.extendedTitle, { feature: named([facts.feature]) }),
        body: fillText(words.extendedBody, { date: date(facts.endsOn) }),
        action: null,
      };
    case "GRANT_ENDING": {
      const when = whenOf(facts.endsOn, context) ?? date(facts.endsOn);
      return {
        title:
          facts.features.length === 1
            ? fillText(words.grantEndingTitleOne, { feature: named(facts.features), when })
            : fillText(words.grantEndingTitleMany, { n: String(facts.features.length), when }),
        body: fillText(words.grantEndingBody, { list: named(facts.features), date: date(facts.endsOn) }),
        action: "PLANS",
      };
    }
    case "GRANT_ENDED":
      return {
        title: fillText(words.grantEndedTitle, { feature: named([facts.feature]) }),
        body: words.grantEndedBody,
        action: "PLANS",
      };
    case "EDITION_ANNOUNCED":
      return {
        title: fillText(words.editionAnnouncedTitle, { plan: plan(facts.plan), date: date(facts.effectiveOn) }),
        body: fillText(words.editionAnnouncedBody, {
          changes: changesOf(facts, context, named),
          date: date(facts.effectiveOn),
        }),
        action: "PLANS",
      };
    case "EDITION_SOON":
      return {
        title: fillText(words.editionSoonTitle, {
          plan: plan(facts.plan),
          when: whenOf(facts.effectiveOn, context) ?? date(facts.effectiveOn),
        }),
        body: fillText(words.editionSoonBody, { date: date(facts.effectiveOn) }),
        action: "PLANS",
      };
    case "EDITION_APPLIED":
      return { title: fillText(words.editionAppliedTitle, { plan: plan(facts.plan) }), body: words.editionAppliedBody, action: "PLANS" };
    case "EDITION_CANCELLED":
      return {
        title: fillText(words.editionCancelledTitle, { plan: plan(facts.plan) }),
        body: words.editionCancelledBody,
        action: null,
      };
    case "PREVIEW_STARTED":
      return {
        title: fillText(words.previewStartedTitle, { feature: named([facts.feature]) }),
        body: fillText(words.previewStartedBody, { date: date(facts.endsOn) }),
        action: "INCLUDED",
      };
    case "PREVIEW_EXTENDED":
      return {
        title: fillText(words.previewExtendedTitle, { feature: named([facts.feature]) }),
        body: fillText(words.previewExtendedBody, { date: date(facts.endsOn) }),
        action: null,
      };
    case "PREVIEW_KEPT":
      return {
        title: fillText(words.previewKeptTitle, { feature: named([facts.feature]) }),
        body: fillText(words.previewKeptBody, { plan: plan(facts.plan) }),
        action: null,
      };
    case "PREVIEW_LEAVING":
      return {
        title: fillText(words.previewLeavingTitle, {
          feature: named([facts.feature]),
          plan: plan(facts.plan),
          date: date(facts.endsOn),
        }),
        body: sentences(
          words.previewLeavingBody,
          facts.addonPriceMinor === null ? null : fillText(words.previewLeavingAddon, { price: money(facts.addonPriceMinor) }),
        ),
        action: "PLANS",
      };
    case "PREVIEW_ENDING":
      return {
        title: fillText(words.previewEndingTitle, {
          feature: named([facts.feature]),
          when: whenOf(facts.endsOn, context) ?? date(facts.endsOn),
        }),
        body: fillText(words.previewEndingBody, { date: date(facts.endsOn) }),
        action: "PLANS",
      };
    case "PLAN_IMPROVED":
      return {
        title: fillText(words.planImprovedTitle, { plan: plan(facts.plan) }),
        body: fillText(words.planImprovedBody, { changes: changesOf({ ...facts, lost: [] }, context, named) }),
        action: null,
      };
    default:
      return addonText(facts, context);
  }
};

type AddonFacts = Extract<NoticeFacts, { kind: `ADDON_${string}` }>;

/** An Add-on's Notices (ADR 0021): always about "the Add-on", so every Feature's name reads right in Hebrew. */
const addonText = (facts: AddonFacts, context: NoticeContext): NoticeText => {
  const { words, billing, language } = context;
  const date = (value: string) => formatLocalDate(value, language);
  const money = (minor: number) => formatPrice(minor, language, "—");
  const feature = billing.featureName[facts.feature];
  switch (facts.kind) {
    case "ADDON_OFFERED":
      return {
        title: fillText(words.addonOfferedTitle, { feature }),
        body: fillText(words.addonOfferedBody, { price: money(facts.priceMinor) }),
        action: "PLANS",
      };
    case "ADDON_ADDED":
      return {
        title: fillText(facts.by === "OWNER" ? words.addonAddedTitle : words.addonAddedByUsTitle, { feature }),
        body: sentences(
          fillText(words.addonAddedBody, { price: money(facts.priceMinor), date: date(facts.paysFrom) }),
          facts.owedMinor === 0 ? null : fillText(words.addonAddedOwed, { owed: money(facts.owedMinor) }),
        ),
        action: null,
      };
    case "ADDON_CANCELLED":
      return {
        title: fillText(facts.by === "OWNER" ? words.addonCancelledTitle : words.addonCancelledByUsTitle, { feature }),
        body: fillText(words.addonCancelledBody, { date: date(facts.endsOn) }),
        action: null,
      };
    case "ADDON_PRICE_RISING":
      return {
        title: fillText(words.addonRisingTitle, { feature, price: money(facts.priceTo) }),
        body: fillText(words.addonRisingBody, { date: date(facts.effectiveOn), old: money(facts.priceFrom) }),
        action: "PLANS",
      };
    case "ADDON_PRICE_SOON":
      return {
        title: fillText(words.addonSoonTitle, {
          feature,
          price: money(facts.priceTo),
          when: whenOf(facts.effectiveOn, context) ?? date(facts.effectiveOn),
        }),
        body: fillText(words.addonSoonBody, { date: date(facts.effectiveOn) }),
        action: "PLANS",
      };
    case "ADDON_RISE_CANCELLED":
      return {
        title: fillText(words.addonRiseCancelledTitle, { feature }),
        body: fillText(words.addonRiseCancelledBody, { price: money(facts.priceMinor) }),
        action: null,
      };
    case "ADDON_PRICE_LOWERED":
      return {
        title: fillText(words.addonLoweredTitle, { feature }),
        body: fillText(words.addonLoweredBody, { price: money(facts.priceTo), old: money(facts.priceFrom) }),
        action: null,
      };
    case "ADDON_INCLUDED":
      return {
        title: fillText(words.addonIncludedTitle, { feature, plan: billing.plan[facts.plan] }),
        body: words.addonIncludedBody,
        action: null,
      };
  }
};

/** When a Notice arrived, the way a list of them says it: today, yesterday, or the date. */
export const noticeDay = (notice: Pick<NoticeDto, "createdAt">, context: NoticeContext & { timeZone: string }): string => {
  const day = localDateOf(notice.createdAt, context.timeZone);
  const ago = daysBetween(parseLocalDate(day), parseLocalDate(context.today));
  if (ago <= 0) return context.words.todayLabel;
  if (ago === 1) return context.words.yesterday;
  return formatLocalDate(day, context.language, { day: "numeric", month: "numeric" });
};
