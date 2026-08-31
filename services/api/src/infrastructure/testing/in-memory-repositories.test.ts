import { describeRepositoryContract } from "../../ports/repositories.contract.ts";
import { inMemoryRepositories } from "./in-memory-repositories.ts";
import { emptyStore } from "./in-memory-store.ts";

/**
 * The in-memory adapter, held to the same contract as Postgres. It always runs;
 * the database side of the same suite runs when a database is reachable.
 */
describeRepositoryContract("in memory", async () => {
  const store = emptyStore();
  return {
    repositories: inMemoryRepositories(store),
    cleanUp: async () => {},
  };
});
