import { asId, validationFailed, type PhotoSlot } from "@tor-now/domain";
import type { Context, Env, Input } from "hono";

/**
 * Hono parameterises a Context by the app's Env, the matched path and the
 * route's input. These helpers care about none of the three, so they take all
 * of them rather than pinning one and forcing a cast at every call site.
 */
type AnyContext<E extends Env> = Context<E, string, Input>;
import type { z } from "zod";
import type { TokenVerifier } from "../ports/tokens.ts";
import type { Actor } from "../ports/unit-of-work.ts";

/**
 * ADR 0007: the Edge Function verifies the caller's JWT, and the identity it
 * finds is then re-established per transaction on the database connection.
 */

export type RequestActor = { actor: Actor };

const BEARER = /^Bearer\s+(.+)$/i;

export const readActor = async <E extends Env>(
  context: AnyContext<E>,
  verifier: TokenVerifier,
): Promise<Actor> => {
  const header = context.req.header("Authorization");
  if (header === undefined) return { kind: "ANONYMOUS" };

  const match = BEARER.exec(header);
  if (match === null) return { kind: "ANONYMOUS" };

  const presented = match[1];
  if (presented === undefined) return { kind: "ANONYMOUS" };

  const claims = await verifier.verify(presented);
  if (claims === null) return { kind: "ANONYMOUS" };

  // ADR 0010's allowlist was checked when the token was issued; the claim is
  // what carries the outcome forward, and it cannot be set by the client
  // because the token is signed.
  return claims.isAdministrator
    ? { kind: "ADMINISTRATOR", userId: claims.userId }
    : { kind: "USER", userId: claims.userId };
};

/**
 * Parses a body, query or parameter against a schema, and turns a failure into
 * the domain's own validation error so the HTTP layer has exactly one way of
 * reporting a bad request.
 */
export const parse = <T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const [first] = result.error.issues;
    const field = first?.path.join(".") ?? "request";
    throw validationFailed(`${field}: ${first?.message ?? "is invalid"}`, {
      issues: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data as z.infer<T>;
};

export const parseBody = async <T extends z.ZodTypeAny, E extends Env>(
  context: AnyContext<E>,
  schema: T,
): Promise<z.infer<T>> => {
  // Hono types a parsed body as `any`; it is unknown until the schema says
  // otherwise, and saying so here keeps the assertion in one place.
  const body: unknown = await context.req.json().catch(() => {
    throw validationFailed("A JSON body is required");
  });
  return parse(schema, body);
};

export const parseQuery = <T extends z.ZodTypeAny, E extends Env>(
  context: AnyContext<E>,
  schema: T,
): z.infer<T> => parse(schema, context.req.query());

/** Path parameters arrive as strings; branding them is a single cast site. */
export const idParam = <T extends string, E extends Env>(
  context: AnyContext<E>,
  name: string,
) => {
  const value = context.req.param(name);
  if (value === undefined || value.length === 0) {
    throw validationFailed(`${name} is required`);
  }
  return asId<T>(value);
};

/**
 * The slot a photo is going into. Validated here rather than trusted, because
 * the database's range check is a backstop and a 400 is a better answer than a
 * constraint violation.
 */
export const photoSlotParam = <E extends Env>(
  context: AnyContext<E>,
): PhotoSlot => {
  const raw = Number(context.req.param("slot"));
  if (raw === 0 || raw === 1 || raw === 2 || raw === 3) return raw;
  throw validationFailed("A photo slot must be 0, 1, 2 or 3", {
    slot: context.req.param("slot"),
  });
};
