import { checkPhone, type FieldProblem } from "@tor-now/domain";

/**
 * The country a customer authenticates from, shown as a flag instead of asking
 * them to type a prefix they may not know. Swap this for a picker once a
 * second country is needed — the shape already carries what a picker would.
 */
export const PHONE_COUNTRY = { flag: "🇮🇱", dial: "+972" } as const;

/** Accepts 0544879900 or 544879900; drops one leading trunk zero, if any. */
export const localDigits = (value: string): string =>
  value.replace(/\D/g, "").replace(/^0/, "");

/** "" while nothing has been typed, so an empty field still reads as REQUIRED. */
export const toE164 = (local: string): string =>
  local.trim() === "" ? "" : `${PHONE_COUNTRY.dial}${localDigits(local)}`;

/** Same rule the domain enforces on the full number, checked without the prefix. */
export const checkLocalPhone = (local: string): FieldProblem | null =>
  checkPhone(toE164(local));
