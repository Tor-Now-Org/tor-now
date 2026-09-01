import type { Sql } from "../infrastructure/pg/client.ts";

/**
 * Where a request's time actually goes.
 *
 * Latency between the Edge Function and the database dominates everything else
 * in this system, and it is invisible from outside: a slow endpoint and a
 * distant database look identical from a browser. This measures the two apart —
 * how long one round trip costs, and how many of them a typical request makes.
 *
 * It runs no application query and returns no data, only timings.
 */
export type DatabaseTimings = {
  readonly connectAndQueryMs: number;
  readonly warmRoundTripMs: number;
  readonly transactionOverheadMs: number;
  readonly roundTripsPerRead: number;
  readonly estimatedReadMs: number;
};

const millisecondsSince = (from: number): number =>
  Math.round((performance.now() - from) * 10) / 10;

export const measureDatabase = async (sql: Sql): Promise<DatabaseTimings> => {
  // First query on this isolate: includes whatever connection setup is needed.
  const coldStart = performance.now();
  await sql`select 1 as ok`;
  const connectAndQueryMs = millisecondsSince(coldStart);

  // Second query on the same pool: one round trip, nothing else.
  const warmStart = performance.now();
  await sql`select 1 as ok`;
  const warmRoundTripMs = millisecondsSince(warmStart);

  // A transaction that does exactly what a read request does: begin, establish
  // the caller's identity, run one statement, commit.
  const transactionStart = performance.now();
  await sql.begin(async (tx) => {
    await tx`select set_config('role', 'anon', true),
                    set_config('request.jwt.claims', '{"role":"anon"}', true)`;
    await tx`select 1 as ok`;
  });
  const transactionMs = millisecondsSince(transactionStart);

  return {
    connectAndQueryMs,
    warmRoundTripMs,
    transactionOverheadMs: Math.round((transactionMs - warmRoundTripMs) * 10) / 10,
    // begin, set_config, the statement itself, commit.
    roundTripsPerRead: 4,
    estimatedReadMs: transactionMs,
  };
};
