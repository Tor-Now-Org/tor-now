import type { AddonDto, FeatureSourceDto } from "@/lib/api/types.ts";
import type { DICTIONARIES } from "@/lib/i18n/dictionaries.ts";
import { fillText } from "@/lib/i18n/fill.ts";

type BillingWords = (typeof DICTIONARIES)["billing"]["he"];

/**
 * What an Add-on's line says, wherever a Business's Features are listed
 * (ADR 0021): its price while it runs on, its last day once cancelled, or the
 * Trial's last day when the Trial is what includes it.
 */
export const addonTagOf = (
  source: Pick<FeatureSourceDto, "feature" | "endsOn">,
  addons: readonly AddonDto[],
  context: { words: BillingWords; money: (minor: number) => string; shortDate: (date: string) => string },
): string => {
  const { words, money, shortDate } = context;
  const addon = addons.find((candidate) => candidate.feature === source.feature);
  if (addon?.holding !== null && addon?.holding !== undefined) {
    return addon.holding.ending === "CANCELLED" && source.endsOn !== null
      ? fillText(words.sourceAddonUntil, { date: shortDate(source.endsOn) })
      : fillText(words.sourceAddon, { price: money(addon.priceMinor) });
  }
  return source.endsOn === null ? words.addons : fillText(words.sourceAddonTrial, { date: shortDate(source.endsOn) });
};
