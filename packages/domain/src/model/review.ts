import type { Instant } from "../time/instant.ts";
import { outcomeOf } from "../booking/outcome.ts";
import type { Appointment } from "./appointment.ts";
import type { BusinessId, ReviewId, UserId } from "./ids.ts";

/** One customer's stars and words about one Business. One each, editable. */
export type Review = {
  readonly id: ReviewId;
  readonly businessId: BusinessId;
  /** Null in a public read of an anonymous review. */
  readonly customerId: UserId | null;
  readonly stars: number;
  readonly comment: string;
  /** Shown without the author's name; the database still knows who wrote it. */
  readonly anonymous: boolean;
  /** The author's given name, and nothing else about them; null when anonymous. */
  readonly authorName: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

export const REVIEW_STARS = Object.freeze({ min: 1, max: 5 });

/**
 * Only a Customer who has been may review: a confirmed Appointment at the
 * Business whose end has passed (outcome FINISHED).
 */
export const mayReview = (
  appointments: readonly Pick<Appointment, "status" | "endAt">[],
  now: Instant,
): boolean => appointments.some((appointment) => outcomeOf(appointment, now) === "FINISHED");
