import {
  formatInstant,
  displayName,
  needsName,
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
  type Customer,
  type User,
  type WorkingHours,
} from "@tor-now/domain";
import type {
  StaffedBusiness,
  TeamMember,
} from "../application/business-service.ts";
import type { BusinessDay, BusinessMonth } from "../application/calendar-service.ts";
import type { Impact, StrandedAppointment } from "../application/stranded.ts";

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
  instagram: business.instagram,
  whatsapp: business.whatsapp,
  active: business.active,
  defaultBufferMinutes: business.defaultBufferMinutes,
  minimumNoticeMinutes: business.minimumNoticeMinutes,
  bookingHorizonDays: business.bookingHorizonDays,
  cancellationWindowHours: business.cancellationWindowHours,
});

/**
 * A Business as it reaches someone who works there, flattened so the client
 * reads one object: the same fields plus the terms they work on it under.
 */
export const staffedBusinessOut = (staffed: StaffedBusiness) => ({
  ...businessOut(staffed.business),
  role: staffed.role,
  resourceIds: staffed.resourceIds,
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
  /** What one decision made together, so a screen can say "3 days". */
  groupId: block.groupId,
});

/**
 * What a closure would strand, for the screen that has to warn about it.
 *
 * The customer is named rather than referred to by id: the owner is deciding
 * whether to call somebody off, and "12 appointments" is not that decision.
 */
export const strandedOut = (stranded: StrandedAppointment) => ({
  id: stranded.id,
  startAt: formatInstant(stranded.startAt),
  resourceName: stranded.resourceName,
  serviceName: stranded.serviceName,
  customerName: stranded.customerName,
  customerPhone: stranded.customerPhone,
});

export const impactOut = (impact: Impact) => ({
  days: impact.days,
  calendars: impact.calendars,
  appointments: impact.appointments.map(strandedOut),
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
  resourceName: appointment.resourceName,
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

/** One day, every calendar: lanes, the hours behind them, and what fills them. */
export const businessDayOut = (day: BusinessDay) => ({
  date: day.date,
  calendars: day.calendars.map((calendar) => ({
    resourceId: calendar.resourceId,
    resourceName: calendar.resourceName,
    // Local Times leave as HH:MM, like everywhere else on the wire — the
    // domain keeps them as minutes and a client should never have to know.
    open: calendar.open.map((range) => ({
      start: formatLocalTime(range.start),
      end: formatLocalTime(range.end),
    })),
    special: calendar.special,
    note: calendar.note,
    appointments: calendar.appointments.map(appointmentWithCustomerOut),
    blocks: calendar.blocks.map(blockOut),
  })),
});

/**
 * The month, with its Local Times as HH:MM like everything else on the wire.
 *
 * The month used to be answered straight out of the service, which sent the
 * shop's hours as the minute counts the domain keeps them in — the same slip
 * that once made the day's timeline draw from NaN. One conversion, in the one
 * place that owns the wire.
 */
export const businessMonthOut = (month: BusinessMonth) => ({
  days: month.days.map((day) => ({
    date: day.date,
    byCalendar: day.byCalendar,
    shopClosed: day.shopClosed,
    shopHours: day.shopHours.map((range) => ({
      start: formatLocalTime(range.start),
      end: formatLocalTime(range.end),
    })),
    shopNote: day.shopNote,
  })),
  blockages: month.blockages,
  closures: month.closures.map((band) => ({
    fromDate: band.fromDate,
    toDate: band.toDate,
    days: band.days,
    note: band.note,
    kind: band.kind,
    hours: band.hours.map((range) => ({
      start: formatLocalTime(range.start),
      end: formatLocalTime(range.end),
    })),
  })),
});

/** A customer's own list names the business, e.g. for an "add to calendar" title. */
export const appointmentWithBusinessOut = ({
  appointment,
  businessName,
  resourceName,
}: {
  appointment: Appointment;
  businessName: string;
  resourceName: string;
}) => ({
  ...appointmentOut(appointment),
  businessName,
  resourceName,
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

/** A User as their Business sees them: the person, plus their standing here. */
export const customerOut = (customer: Customer) => ({
  ...userOut(customer.user),
  blocked: customer.membership?.blockedAt != null,
});

/** A colleague: the person, the terms, and the calendars they are on. */
export const teamMemberOut = (member: TeamMember) => {
  const pending = needsName(member.user);
  const { invitedGivenName, invitedFamilyName } = member.membership;
  const name =
    pending && invitedGivenName !== null
      ? displayName({ givenName: invitedGivenName, familyName: invitedFamilyName })
      : displayName(member.user);

  return {
    ...userOut(member.user),
    name,
    membershipId: member.membership.id,
    role: member.membership.role,
    resourceIds: member.resourceIds,
    joinedAt: formatInstant(member.membership.createdAt),
    pending,
  };
};

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
