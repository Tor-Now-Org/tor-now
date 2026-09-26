import type { PlanVersion } from "@tor-now/domain";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";

/**
 * The Catalogue as anyone may read it: what each Plan offers new Businesses
 * today. Public, as the pricing page is — there is nothing in it to hide.
 */
export const catalogueService = ({ unitOfWork }: { unitOfWork: UnitOfWork }) => ({
  async currentPlans(actor: Actor): Promise<readonly PlanVersion[]> {
    return unitOfWork.run(actor, ({ repositories }) => repositories.planVersions.listCurrent());
  },
});
