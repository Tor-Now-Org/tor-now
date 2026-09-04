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

/** The inverse of {@link toE164}, for pre-filling the field from a stored number. */
export const fromE164 = (e164: string): string =>
  e164.startsWith(PHONE_COUNTRY.dial) ? e164.slice(PHONE_COUNTRY.dial.length) : localDigits(e164);

/**
 * Same rule the domain enforces on the full number, checked without the
 * prefix — the length must be judged on what the person actually typed, since
 * the dial code padding it out to E.164 would otherwise hide a short entry.
 */
export const checkLocalPhone = (local: string): FieldProblem | null => {
  if (local.trim() === "") return "REQUIRED";
  if (localDigits(local).length < 9) return "TOO_SHORT";
  return checkPhone(toE164(local));
};
