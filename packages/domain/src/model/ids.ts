/**
 * Identifiers are branded so a ResourceId cannot be passed where a ServiceId
 * belongs. They carry no format rule in the domain — the database issues them.
 */
type Id<Tag extends string> = string & { readonly __idBrand: Tag };

export type BusinessId = Id<"Business">;
export type ResourceId = Id<"Resource">;
export type ServiceId = Id<"Service">;
export type UserId = Id<"User">;
export type AppointmentId = Id<"Appointment">;
export type MembershipId = Id<"Membership">;
export type BlockId = Id<"Block">;
export type WorkingHoursId = Id<"WorkingHours">;
export type DateOverrideId = Id<"DateOverride">;
export type SubscriptionId = Id<"Subscription">;
export type PaymentId = Id<"Payment">;
export type BusinessPhotoId = Id<"BusinessPhoto">;

/** The single cast site. Everywhere else, ids are already branded. */
export const asId = <T extends string>(value: string): Id<T> => value as Id<T>;
