/**
 * The error codes the API raises, and what the interface does about each. The
 * server's message is for developers; the interface renders its own translated
 * text, so a code that reaches here without a case is a visible gap rather than
 * an English sentence shown to a Hebrew-speaking customer.
 */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SLOT_TAKEN"
  | "ALREADY_CANCELLED"
  | "ALREADY_STARTED"
  | "OUTSIDE_BOOKING_WINDOW"
  | "OUTSIDE_WORKING_HOURS"
  | "BUSINESS_INACTIVE"
  | "VERIFICATION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "NETWORK";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError;

/**
 * ADR 0003 makes this one recoverable rather than terminal: the customer keeps
 * the business, the service and the day they chose, and only the time is
 * re-asked.
 */
export const isRecoverableSlotError = (error: unknown): boolean =>
  isApiError(error) &&
  (error.code === "SLOT_TAKEN" || error.code === "OUTSIDE_WORKING_HOURS");
