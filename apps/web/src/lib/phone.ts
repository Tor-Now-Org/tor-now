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

/**
 * A number as it is dialled in Israel, for reading rather than typing:
 * "+972549534655" is "054-953-4655", a landline "+97231234567" is
 * "03-123-4567". A number from abroad, or one that is not a whole Israeli
 * number, is left as it was rather than broken into a shape it does not have.
 */
export const phoneShown = (e164: string): string => {
  const digits = e164.replace(/\D/g, "");
  if (!e164.trim().startsWith(PHONE_COUNTRY.dial) || !digits.startsWith("972")) return e164;
  const national = `0${digits.slice(3)}`;
  // Mobile, VoIP and the 1-800 kind: three, three, four.
  if (national.length === 10) return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  // A landline: the area code, then three and four.
  if (national.length === 9) return `${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
  return e164;
};
