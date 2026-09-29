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
  /**
   * An Edge Function has no single pool: every isolate opens its own, so
   * whatever this says is multiplied by however many isolates are warm. Four
   * was sized for "the widest fan-out a single request makes", which misreads
   * postgres.js — `begin` reserves one connection and every query through the
   * transaction queues onto it, so a request has only ever used one however
   * wide its `Promise.all`.
   *
   * One would therefore be enough, and two is the margin: a query run on the
   * pool rather than in the caller's transaction (verification codes, the job
   * credential) needs a second connection, and at a maximum of one such a query
   * issued inside a transaction would wait forever for the connection its own
   * caller is holding. Nothing does that today. Two means nothing has to keep
   * not doing it.
   */
  maxConnections: 2,
  /**
   * The database has 60 slots for every isolate, every job and Supabase's own
   * services together, so an isolate that has stopped working gives its slot
   * back rather than holding it against the next one. Reconnecting costs a
   * round trip; running out of slots costs a 500.
   */
  idleSeconds: 15,
  connectSeconds: 10,
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
