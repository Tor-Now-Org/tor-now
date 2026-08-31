import { afterAll, describe, it } from "vitest";
import { describeRepositoryContract } from "../../ports/repositories.contract.ts";
import { createPool, type Transaction } from "./client.ts";
import { appointmentRepository } from "./appointment-repository.ts";
import { paymentRepository, subscriptionRepository } from "./billing-repositories.ts";
import {
  administratorAllowlistRepository,
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
          if (!(error instanceof RollBack)) reject(error);
        });
    });

    return {
      repositories: {
        users: userRepository(transaction),
        businesses: businessRepository(transaction),
        memberships: membershipRepository(transaction),
        resources: resourceRepository(transaction),
        services: serviceRepository(transaction),
        workingHours: workingHoursRepository(transaction),
        dateOverrides: dateOverrideRepository(transaction),
        blocks: blockRepository(transaction),
        appointments: appointmentRepository(transaction),
        subscriptions: subscriptionRepository(transaction),
        payments: paymentRepository(transaction),
        administratorAllowlist: administratorAllowlistRepository(transaction),
      },
      cleanUp: async () => {
        release();
      },
    };
  });
}

/** Signals the deliberate rollback, so a real failure is still reported. */
class RollBack extends Error {
  constructor() {
    super("intentional rollback");
    this.name = "RollBack";
  }
}
