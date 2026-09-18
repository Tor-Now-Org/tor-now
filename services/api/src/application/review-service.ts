import { forbidden, mayReview, type BusinessId, type Clock, type Review } from "@tor-now/domain";
import { actorUserId, type Actor, type UnitOfWork } from "../ports/unit-of-work.ts";
import { requireUser } from "./authorization.ts";

export type BusinessReviews = {
  readonly reviews: readonly Review[];
  /** The caller's own review, when they are signed in and have written one. */
  readonly mine: Review | null;
  /** Whether the caller may write (or edit) one: a confirmed Appointment here that has ended. */
  readonly mayReview: boolean;
};

export const reviewService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => ({
  forBusiness(actor: Actor, businessId: BusinessId): Promise<BusinessReviews> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      const reviews = await repositories.reviews.listForBusiness(businessId);
      // An administrator is a User too, and may have been a customer here.
      const userId = actorUserId(actor);
      if (userId === null) return { reviews, mine: null, mayReview: false };
      const [mine, appointments] = await Promise.all([
        repositories.reviews.findFor(businessId, userId),
        repositories.appointments.listForCustomerAtBusiness(userId, businessId),
      ]);
      return { reviews, mine, mayReview: mayReview(appointments, clock.now()) };
    });
  },

  /** Writes the caller's review the first time and edits it every time after. */
  write(
    actor: Actor,
    businessId: BusinessId,
    review: { stars: number; comment: string; anonymous: boolean },
  ): Promise<Review> {
    const customerId = requireUser(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const appointments = await repositories.appointments.listForCustomerAtBusiness(
        customerId,
        businessId,
      );
      if (!mayReview(appointments, clock.now())) {
        throw forbidden("Only a customer whose confirmed appointment has ended may review this business");
      }
      return repositories.reviews.put({ businessId, customerId, ...review });
    });
  },
});
