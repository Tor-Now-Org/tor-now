import { validationFailed } from "../shared/errors.ts";

/**
 * Money is held in the minor unit (agorot) as an integer, never as a float.
 * The currency is fixed for the platform; a Business does not choose one.
 */
export const CURRENCY = "ILS" as const;
export const MINOR_UNITS_PER_MAJOR = 100;

export type Money = number & { readonly __brand: "Money" };

export const money = (minorUnits: number): Money => {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) {
    throw validationFailed(
      `Money must be a whole, non-negative number of minor units, got ${minorUnits}`,
    );
  }
  return minorUnits as Money;
};

export const fromMajorUnits = (major: number): Money =>
  money(Math.round(major * MINOR_UNITS_PER_MAJOR));

export const toMajorUnits = (amount: Money): number =>
  amount / MINOR_UNITS_PER_MAJOR;
