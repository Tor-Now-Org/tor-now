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

export type NoticeAction = "PAY" | "PLANS" | "CANCEL_MOVE";

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

export const noticeText = (facts: NoticeFacts, context: NoticeContext): NoticeText => {
  const { words, billing, language } = context;
  const date = (value: string) => formatLocalDate(value, language);
  const plan = (value: PlanName) => billing.plan[value];
  const features = (list: readonly FeatureName[]) =>
    namesOf(list.map((feature) => billing.featureLine[feature]), language);

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
