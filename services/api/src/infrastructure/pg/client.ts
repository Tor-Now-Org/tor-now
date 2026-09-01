import postgres from "postgres";
import type { Actor } from "../../ports/unit-of-work.ts";

export type Sql = postgres.Sql;
export type Transaction = postgres.TransactionSql;

/**
 * Anything a query can run on. The verification-code table carries no RLS
 * policy — only the Edge Function may touch it — so its repository runs on the
 * pool directly rather than inside a caller's transaction.
 */
export type Queryable = Sql | Transaction;

const POOL = Object.freeze({
  /** Enough for the widest fan-out a single request makes. */
  maxConnections: 4,
  /**
   * Opening a connection to a distant database costs seconds, so an idle one is
   * kept far longer than a request lasts: a customer clicking through a booking
   * reuses the connection their search opened instead of paying for it again.
   */
  idleSeconds: 600,
  connectSeconds: 15,
});

/**
 * ADR 0007: `supabase-js` speaks to PostgREST and offers no transactions, so
 * the domain layer connects to Postgres directly through Supavisor.
 *
 * Prepared statements are disabled because Supavisor pools in transaction mode,
 * where a statement prepared on one physical connection is not there on the
 * next.
 */
export const createPool = (databaseUrl: string): Sql =>
  postgres(databaseUrl, {
    prepare: false,
    max: POOL.maxConnections,
    idle_timeout: POOL.idleSeconds,
    connect_timeout: POOL.connectSeconds,
    onnotice: () => {},
  });

/**
 * Re-establishes the caller's identity on the connection for the life of one
 * transaction. Both settings are transaction-local and therefore cannot leak
 * across pooled connections, which is what makes `auth.uid()` — and every RLS
 * policy resting on it — resolve correctly inside a real transaction.
 *
 * An administrator is deliberately left as the connecting role, which bypasses
 * RLS. ADR 0010 bounds that path and ADR 0006 audits it; there is no database
 * backstop on it, only application code.
 */
export const assumeIdentity = async (
  tx: Transaction,
  actor: Actor,
): Promise<void> => {
  if (actor.kind === "ADMINISTRATOR" || actor.kind === "SYSTEM") return;

  const role = actor.kind === "USER" ? "authenticated" : "anon";
  const claims =
    actor.kind === "USER"
      ? JSON.stringify({ sub: actor.userId, role })
      : JSON.stringify({ role });

  // One statement, not two. Every round trip to the database is a round trip
  // the customer waits for, and these two settings always travel together.
  await tx`
    select set_config('role', ${role}, true),
           set_config('request.jwt.claims', ${claims}, true)`;
};

/** Postgres error codes the application translates rather than propagates. */
export const PG_ERRORS = Object.freeze({
  exclusionViolation: "23P01",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
});

export const errorCodeOf = (error: unknown): string | null => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error).code;
    return typeof code === "string" ? code : null;
  }
  return null;
};
