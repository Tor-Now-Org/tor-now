/**
 * What a number box keeps of what was typed into it.
 *
 * Digits only, and one decimal point where the number may have a fraction.
 * Leading zeros go: typing eighty into a box that held a nought — with the
 * caret after it, which is where a finger leaves it on a phone — gives "80",
 * never "080". A lone nought stays, since nought is a number; so does the
 * nought before a decimal point.
 */
export const cleanNumberText = (typed: string, decimals: boolean): string => {
  const kept = decimals ? typed.replace(/[^\d.]/g, "") : typed.replace(/\D/g, "");
  const [whole = "", ...rest] = kept.split(".");
  const fraction = rest.join("");
  const hasPoint = decimals && kept.includes(".");
  const trimmed = whole.replace(/^0+(?=\d)/, "");
  if (!hasPoint) return trimmed;
  return `${trimmed === "" ? "0" : trimmed}.${fraction}`;
};
