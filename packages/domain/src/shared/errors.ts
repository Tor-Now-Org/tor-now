/**
 * The domain's error vocabulary. Every failure a caller is expected to handle
 * is one of these; anything else is a bug and propagates as a plain Error.
 *
 * `code` is stable and machine-readable — the HTTP layer maps it to a status
 * and the interface maps it to a translated message. The `message` here is for
 * logs and developers, never for an end user.
 */
export type DomainErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "SLOT_TAKEN"
  | "OUTSIDE_BOOKING_WINDOW"
  | "OUTSIDE_WORKING_HOURS"
  | "BUSINESS_INACTIVE"
  | "ALREADY_CANCELLED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "VERIFICATION_FAILED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const validationFailed = (
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError => new DomainError("VALIDATION_FAILED", message, details);

export const notFound = (entity: string, id?: string): DomainError =>
  new DomainError("NOT_FOUND", `${entity} not found`, id === undefined ? {} : { id });

export const forbidden = (message: string): DomainError =>
  new DomainError("FORBIDDEN", message);

export const unauthenticated = (message = "Authentication required"): DomainError =>
  new DomainError("UNAUTHENTICATED", message);

export const isDomainError = (error: unknown): error is DomainError =>
  error instanceof DomainError;
