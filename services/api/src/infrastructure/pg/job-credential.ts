import type { Queryable } from "./client.ts";

/**
 * Scheduled work authenticates with a credential that lives in the database and
 * is read by both sides from the same place (see the scheduled_work migration).
 * It is generated there and never leaves it, so there is no value for an
 * operator to copy, paste or leak — and no second secret to rotate.
 */
export type JobCredential = { read(): Promise<string | null> };

export const jobCredential = (sql: Queryable): JobCredential => ({
  async read() {
    const rows = await sql<{ secret: string | null }[]>`select app.job_secret() as secret`;
    return rows[0]?.secret ?? null;
  },
});
