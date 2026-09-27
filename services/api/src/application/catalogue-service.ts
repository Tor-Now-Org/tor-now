import type { PlanVersion, Preview } from "@tor-now/domain";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * The Catalogue as anyone may read it: what each Plan offers new Businesses
 * today, and which Features are on every Plan for now, as a Preview. Public,
 * as the pricing page is — there is nothing in it to hide.
 */
export const catalogueService = ({ unitOfWork }: { unitOfWork: UnitOfWork }) => ({
  async current(
    actor: Actor,
  ): Promise<{ readonly plans: readonly PlanVersion[]; readonly previews: readonly Preview[] }> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const [plans, previews] = await Promise.all([
        repositories.planVersions.listCurrent(),
        repositories.previews.list(),
      ]);
      return { plans, previews };
    });
  },
});
