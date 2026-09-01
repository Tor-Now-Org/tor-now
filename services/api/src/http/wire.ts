import {
  formatInstant,
  displayName,
  formatLocalTime,
  toMajorUnits,
  type Appointment,
  type Block,
  type Business,
  type BusinessPhoto,
  type DateOverride,
  type Payment,
  type Resource,
  type Service,
  type Subscription,
  type User,
  type WorkingHours,
} from "@tor-now/domain";

/**
 * What crosses the wire, stated explicitly rather than by serialising whatever
 * the domain happens to hold. Two consequences are deliberate:
 *
 * Instants leave as ISO strings and Local Times as HH:MM, so a client never has
 * to know that one is an epoch and the other a count of minutes.
 *
 * ADR 0007 keeps customer identities and booking volume off the availability
 * endpoint; the same principle applies here, which is why a Business carries no
 * counts and an Appointment reaches a customer without its Resource's other
 * bookings.
 */

export const businessOut = (business: Business) => ({
  id: business.id,
  name: business.name,
  phone: business.phone,
  timeZone: business.timeZone,
  description: business.description,
  address: business.address,
  active: business.active,
  defaultBufferMinutes: business.defaultBufferMinutes,
  minimumNoticeMinutes: business.minimumNoticeMinutes,
  bookingHorizonDays: business.bookingHorizonDays,
  cancellationWindowHours: business.cancellationWindowHours,
});

/**
 * A photo, addressed. Where it is served from depends on which store is behind
 * the deployment, so the store is asked rather than the URL being assembled
 * from a pattern that would be wrong on the other one.
 */
export const businessPhotoOut = (photo: BusinessPhoto, urlFor: (path: string) => string) => ({
  id: photo.id,
  slot: photo.slot,
  url: urlFor(photo.storagePath),
  contentType: photo.contentType,
  byteSize: photo.byteSize,
});

export const serviceOut = (service: Service) => ({
  id: service.id,
  businessId: service.businessId,
  name: service.name,
  durationMinutes: service.durationMinutes,
  priceMinor: service.price,
  price: toMajorUnits(service.price),
  bufferMinutes: service.bufferMinutes,
  active: service.active,
});

export const resourceOut = (resource: Resource) => ({
  id: resource.id,
  businessId: resource.businessId,
  name: resource.name,
  active: resource.active,
});

export const workingHoursOut = (hours: WorkingHours) => ({
  id: hours.id,
  resourceId: hours.resourceId,
  dayOfWeek: hours.dayOfWeek,
  start: formatLocalTime(hours.start),
  end: formatLocalTime(hours.end),
});

export const overrideOut = (override: DateOverride) => ({
  id: override.id,
  resourceId: override.resourceId,
  date: override.date,
  note: override.note,
  ranges: override.ranges.map((range) => ({
    start: formatLocalTime(range.start),
    end: formatLocalTime(range.end),
  })),
  /** An Override with no ranges is a day off; naming it saves every client the rule. */
  closed: override.ranges.length === 0,
});

export const blockOut = (block: Block) => ({
  id: block.id,
  resourceId: block.resourceId,
  startAt: formatInstant(block.startAt),
  endAt: formatInstant(block.endAt),
  reason: block.reason,
});

export const appointmentOut = (appointment: Appointment) => ({
  id: appointment.id,
  businessId: appointment.businessId,
  resourceId: appointment.resourceId,
  serviceId: appointment.serviceId,
  customerId: appointment.customerId,
  startAt: formatInstant(appointment.startAt),
  endAt: formatInstant(appointment.endAt),
  status: appointment.status,
  serviceName: appointment.serviceName,
  priceMinor: appointment.price,
  price: toMajorUnits(appointment.price),
  durationMinutes: appointment.durationMinutes,
  customerNote: appointment.customerNote,
  cancelledAt:
    appointment.cancelledAt === null ? null : formatInstant(appointment.cancelledAt),
  cancelledBy: appointment.cancelledBy,
  lateCancellation: appointment.lateCancellation,
  createdAt: formatInstant(appointment.createdAt),
});

/** The owner's calendar needs the customer on the card; a customer's list does not. */
export const appointmentWithCustomerOut = (
  appointment: Appointment & { customerName: string; customerPhone: string },
) => ({
  ...appointmentOut(appointment),
  customerName: appointment.customerName,
  customerPhone: appointment.customerPhone,
});

export const userOut = (user: User) => ({
  id: user.id,
  phone: user.phone,
  givenName: user.givenName,
  familyName: user.familyName,
  /** Joined once, here, so every client shows the same thing. */
  name: displayName(user),
  birthDate: user.birthDate,
  isAdministrator: user.isAdministrator,
  deleted: user.deletedAt !== null,
  anonymised: user.anonymisedAt !== null,
  createdAt: formatInstant(user.createdAt),
});

export const subscriptionOut = (subscription: Subscription) => ({
  id: subscription.id,
  businessId: subscription.businessId,
  plan: subscription.plan,
  amountMinor: subscription.amount,
  amount: toMajorUnits(subscription.amount),
  billingPeriod: subscription.billingPeriod,
  paidThrough: subscription.paidThrough,
});

export const paymentOut = (payment: Payment) => ({
  id: payment.id,
  businessId: payment.businessId,
  amountMinor: payment.amount,
  amount: toMajorUnits(payment.amount),
  paidOn: payment.paidOn,
  note: payment.note,
  recordedAt: formatInstant(payment.recordedAt),
});
