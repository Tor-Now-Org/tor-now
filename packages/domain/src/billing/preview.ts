import { validationFailed } from "../shared/errors.ts";
import { addDays, compareLocalDate, daysBetween, type LocalDate } from "../time/local-date.ts";
import type { Preview } from "./entitlement.ts";
import type { Feature } from "./feature.ts";
import { NOTICE_DAYS } from "./subscription.ts";
import type { Plan, PlanVersion } from "./plan.ts";

/**
 * Previews (ADR 0020): a new Feature offered on every Plan for a stated
 * period, not yet placed. When it ends, each Plan either keeps it — which only
 * gives, and applies at once — or loses it, which takes, so it needs thirty
 * days' Notice. Nothing ends without that Notice: a Preview nobody has decided
 * on stretches itself before its end comes close.
 */

/** Shorter than the Notice a Plan losing it needs, and it could never end on time. */
export const MIN_PREVIEW_DAYS = NOTICE_DAYS;
export const MAX_PREVIEW_DAYS = 365;

/** What each Plan does with the Feature when the Preview ends; null while undecided. */
export type PreviewPlacement = { readonly keepOn: readonly Plan[] } | null;

const runsThrough = (endsOn: LocalDate, today: LocalDate): boolean => compareLocalDate(today, endsOn) <= 0;

/**
 * Whether a Feature can go into Preview: some current Plan lacks it, and no
 * Preview of it is running.
 */
export const canPreview = (
  feature: Feature,
  input: { current: readonly PlanVersion[]; previews: readonly Preview[]; today: LocalDate },
): boolean =>
  input.current.some((edition) => !edition.terms.features.includes(feature)) &&
  !input.previews.some((preview) => preview.feature === feature && runsThrough(preview.endsOn, input.today));

export const checkPreviewStart = (input: {
  feature: Feature;
  endsOn: LocalDate;
  current: readonly PlanVersion[];
  previews: readonly Preview[];
  today: LocalDate;
}): void => {
  if (!canPreview(input.feature, input)) {
    throw validationFailed("Every Plan has this Feature, or it is in Preview already", { field: "feature" });
  }
  const days = daysBetween(input.today, input.endsOn);
  if (days < MIN_PREVIEW_DAYS || days > MAX_PREVIEW_DAYS) {
    throw validationFailed("A Preview runs thirty days to a year", {
      field: "endsOn",
      minDays: MIN_PREVIEW_DAYS,
      maxDays: MAX_PREVIEW_DAYS,
    });
  }
};

/** A running Preview carried to a later day. */
export const checkPreviewExtension = (preview: Preview, endsOn: LocalDate, today: LocalDate): void => {
  if (!runsThrough(preview.endsOn, today)) throw validationFailed("Only a running Preview can be extended");
  if (compareLocalDate(endsOn, preview.endsOn) <= 0) {
    throw validationFailed("An extension ends later than the Preview does", { field: "endsOn" });
  }
  if (daysBetween(today, endsOn) > MAX_PREVIEW_DAYS) {
    throw validationFailed("A Preview runs at most a year ahead", { field: "endsOn" });
  }
};

/**
 * Deciding where a Preview's Feature goes. The Plans that lose it are told
 * now, and lose it no sooner than thirty days from now: the end moves out if
 * it is nearer than that.
 */
export const placePreview = (
  preview: Preview,
  keepOn: readonly Plan[],
  today: LocalDate,
): { readonly keepOn: readonly Plan[]; readonly endsOn: LocalDate } => {
  if (!runsThrough(preview.endsOn, today)) throw validationFailed("Only a running Preview can be placed");
  const earliest = addDays(today, NOTICE_DAYS);
  return {
    keepOn: [...new Set(keepOn)],
    endsOn: compareLocalDate(preview.endsOn, earliest) < 0 ? earliest : preview.endsOn,
  };
};

/**
 * A Preview still undecided within thirty days of its end is carried thirty
 * days further, so no Plan can lose it without its Notice. Null when nothing
 * needs to move.
 */
export const stretchUndecided = (
  preview: Preview & { readonly placement: PreviewPlacement },
  today: LocalDate,
): LocalDate | null => {
  if (preview.placement !== null || !runsThrough(preview.endsOn, today)) return null;
  return daysBetween(today, preview.endsOn) < NOTICE_DAYS ? addDays(preview.endsOn, NOTICE_DAYS) : null;
};
