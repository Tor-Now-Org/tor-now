import { afterAll, describe, expect, it } from "vitest";
import { describeRepositoryContract } from "../../ports/repositories.contract.ts";
import { createPool, type Transaction } from "./client.ts";
import { appointmentRepository } from "./appointment-repository.ts";
import { paymentRepository, subscriptionRepository } from "./billing-repositories.ts";
import {
  administratorAllowlistRepository,
  businessPhotoRepository,
  businessRepository,
  membershipRepository,
  userRepository,
} from "./identity-repositories.ts";
import {
  blockRepository,
  dateOverrideRepository,
  resourceRepository,
  serviceRepository,
  workingHoursRepository,
} from "./scheduling-repositories.ts";

/**
 * The same contract, against a real Postgres.
 *
 * This is where the exclusion constraint, the composite foreign keys and the
 * `security definer` span functions are actually exercised — the in-memory
 * adapter can only imitate them. It runs when TEST_DATABASE_URL points at a
 * database the suite may write to, and is skipped otherwise so a laptop with no
 * Postgres still gets a green suite.
 *
 * Each case runs inside a transaction that is always rolled back, so the
 * database is left exactly as it was found.
 */
const databaseUrl = process.env["TEST_DATABASE_URL"];

if (databaseUrl === undefined || databaseUrl === "") {
  describe.skip("repository contract (postgres)", () => {
    it("needs TEST_DATABASE_URL", () => {});
  });
} else {
  const sql = createPool(databaseUrl);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /**
   * Every repository method that exists, and every one the contract actually
   * ran against this database.
   *
   * A repository method is hand-written SQL, and hand-written SQL is the one
   * place in this codebase where renaming a column does not become a type
   * error: a row is a bag of unknowns until the mapper reads it. Two statements
   * have already gone wrong exactly that way, and neither surfaced until
   * production — `dueForReminder` went on selecting a column the name split had
   * renamed four migrations earlier, because no test ever executed it against a
   * real database.
   *
   * So the guard is not a scan for column names, which would only find the
   * mistakes somebody thought of. It is this: a method with no Postgres
   * coverage fails the suite. Whether the SQL is *right* is still for the
   * contract to say — but it can no longer be nobody's job to ask.
   */
  const reachable = new Set<string>();
  const exercised = new Set<string>();

  const recording = <T extends object>(name: string, repository: T): T => {
    for (const method of Object.keys(repository)) reachable.add(`${name}.${method}`);
    return new Proxy(repository, {
      get: (target, property, receiver) => {
        if (typeof property === "string") exercised.add(`${name}.${property}`);
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  };

  describeRepositoryContract("postgres", async () => {
    // A transaction held open for the length of one case, then rolled back.
    let release: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });

    const transaction = await new Promise<Transaction>((resolve, reject) => {
      sql
        .begin(async (tx) => {
          resolve(tx as Transaction);
          await finished;
          // Rolling back is the clean-up; nothing this suite writes survives.
          throw new RollBack();
        })
        .catch((error: unknown) => {
          if (!(error instanceof RollBack)) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
    });

    return {
      repositories: {
        users: recording("users", userRepository(transaction)),
        businesses: recording("businesses", businessRepository(transaction)),
        businessPhotos: recording("businessPhotos", businessPhotoRepository(transaction)),
        memberships: recording("memberships", membershipRepository(transaction)),
        resources: recording("resources", resourceRepository(transaction)),
        services: recording("services", serviceRepository(transaction)),
        workingHours: recording("workingHours", workingHoursRepository(transaction)),
        dateOverrides: recording("dateOverrides", dateOverrideRepository(transaction)),
        blocks: recording("blocks", blockRepository(transaction)),
        appointments: recording("appointments", appointmentRepository(transaction)),
        subscriptions: recording("subscriptions", subscriptionRepository(transaction)),
        payments: recording("payments", paymentRepository(transaction)),
        administratorAllowlist: recording(
          "administratorAllowlist",
          administratorAllowlistRepository(transaction),
        ),
      },
      cleanUp: async () => {
        release();
      },
    };
  });

  // Declared last on purpose: vitest runs describe blocks in the order they are
  // written, and this one asks what the suite above it did.
  describe("statements nothing runs", () => {
    it("has none: every repository method reaches Postgres at least once", () => {
      const untouched = [...reachable]
        .filter((method) => !exercised.has(method))
        .sort();
      // Naming them is the point. The failure should say which statement has
      // never been executed, not merely that one has not.
      expect(untouched).toEqual([]);
    });
  });
}

/** Signals the deliberate rollback, so a real failure is still reported. */
class RollBack extends Error {
  constructor() {
    super("intentional rollback");
    this.name = "RollBack";
  }
}
