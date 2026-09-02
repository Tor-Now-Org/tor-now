/**
 * What counts as a filled-in field.
 *
 * These rules were in three places at once: a regex in the wizard, a zod schema
 * at the API boundary, and a CHECK constraint in the schema — which meant a
 * person could be told a name was fine, have it accepted by the browser, and
 * then refused by the database with a message written for an operator. They
 * live here now, and both sides read them, so the browser refuses exactly what
 * the API would have refused and says so before the request is made.
 *
 * The rules are deliberately loose about what a name may contain. A person's
 * name is theirs, and a system that decides which characters are allowed in one
 * is wrong far more often than the people it corrects.
 */

/** E.164, which is also what the database's CHECK constraint enforces. */
export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export type TextRule = {
  readonly min: number;
  readonly max: number;
};

export const TEXT_RULES = Object.freeze({
  /** A single-character given name is a real name in more than one language. */
  personName: { min: 1, max: 80 },
  businessName: { min: 2, max: 80 },
  serviceName: { min: 2, max: 80 },
  resourceName: { min: 1, max: 60 },
  address: { min: 1, max: 120 },
  description: { min: 0, max: 400 },
  note: { min: 0, max: 500 },
  reason: { min: 0, max: 200 },
  /**
   * Why an administrator did something. ADR 0006 keeps it beside the change,
   * so it has to say enough to be worth reading a year later.
   */
  auditReason: { min: 3, max: 200 },
  code: { min: 4, max: 8 },
}) satisfies Readonly<Record<string, TextRule>>;

/**
 * Why a value is not acceptable, as a reason rather than a sentence: the API
 * and the two languages the interface speaks each say it their own way.
 */
export type FieldProblem = "REQUIRED" | "TOO_SHORT" | "TOO_LONG" | "NOT_A_PHONE";

export const checkText = (value: string, rule: TextRule): FieldProblem | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return rule.min === 0 ? null : "REQUIRED";
  if (trimmed.length < rule.min) return "TOO_SHORT";
  if (trimmed.length > rule.max) return "TOO_LONG";
  return null;
};

/**
 * A phone number is the identity in this system (ADR 0004), so an empty one is
 * missing rather than merely malformed — the two want different sentences.
 */
export const checkPhone = (value: string): FieldProblem | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "REQUIRED";
  return PHONE_PATTERN.test(trimmed) ? null : "NOT_A_PHONE";
};

/** True when every field given is acceptable. */
export const allAcceptable = (
  problems: readonly (FieldProblem | null)[],
): boolean => problems.every((problem) => problem === null);
