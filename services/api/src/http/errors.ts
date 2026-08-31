import { isDomainError, type DomainErrorCode } from "@tor-now/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * One place that decides what a failure looks like on the wire. The domain
 * raises a code; the interface translates that code into a message its user can
 * read. The `message` here is for developers, never for an end user — which is
 * why it is not the thing the interface renders.
 */
const STATUS_BY_CODE: Readonly<Record<DomainErrorCode, ContentfulStatusCode>> =
  Object.freeze({
    VALIDATION_FAILED: 400,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    // ADR 0003 makes this recoverable rather than terminal: the interface
    // re-renders availability in place instead of losing the customer's work.
    SLOT_TAKEN: 409,
    ALREADY_CANCELLED: 409,
    OUTSIDE_BOOKING_WINDOW: 422,
    OUTSIDE_WORKING_HOURS: 422,
    BUSINESS_INACTIVE: 422,
    VERIFICATION_FAILED: 422,
    RATE_LIMITED: 429,
  });

export type ErrorBody = {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
};

export const toErrorResponse = (
  context: Context,
  error: unknown,
  exposeInternalErrors = false,
): Response => {
  if (isDomainError(error)) {
    const status = STATUS_BY_CODE[error.code] ?? 400;
    return context.json<ErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(Object.keys(error.details).length === 0
            ? {}
            : { details: error.details }),
        },
      },
      status,
    );
  }

  // Anything reaching here is a bug. In production the client learns nothing
  // about it beyond that it happened — an unhandled message can name a table or
  // a constraint — and the log keeps the detail.
  console.error("[unhandled]", error);
  return context.json<ErrorBody>(
    {
      error: {
        code: "INTERNAL",
        message: "Something went wrong",
        ...(exposeInternalErrors
          ? {
              details: {
                cause: error instanceof Error ? error.message : String(error),
              },
            }
          : {}),
      },
    },
    500,
  );
};
