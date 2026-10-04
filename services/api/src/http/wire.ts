import {
  formatInstant,
  displayName,
  needsName,
  formatLocalTime,
  toMajorUnits,
  type Appointment,
  type Block,
  type Business,
  type BusinessCategory,
  type BusinessPhoto,
  type CalendarChange,
  type DateOverride,
  type LocalTimeRangeValue,
  type Payment,
  type PlanVersion,
  type Resource,
  type Review,
  type Service,
  type Customer,
  type User,
  type WorkingHours,
  isStanding,
  noticeTone,
  type FeatureSource,
  type GrantTerm,
  type Preview,
  type DaysOwed,
} from "@tor-now/domain";
import type { MyWaiting } from "../application/waiting-service.ts";
import type { ChangePreview } from "../application/change-service.ts";
import type { PlatformStats } from "../application/admin-service.ts";
import type { PaymentBoard } from "../application/addon-service.ts";
import type { SubscriptionView } from "../application/billing.ts";
import type { NoticeBoard } from "../application/notice-service.ts";
import type { PlanView } from "../application/plan-catalogue.ts";
import type { FeatureView } from "../application/feature-catalogue.ts";
import type { GrantEntry, PlanEdition, UnitRateEntry } from "../ports/repositories.ts";
import type { DirectoryRow } from "../application/business-directory.ts";
import type {
  ResourceWithUpcoming,
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

export const platformStatsOut = (stats: PlatformStats) => stats;

export const businessOut = (business: Business) => ({
  id: business.id,
  name: business.name,
  phone: business.phone,
  timeZone: business.timeZone,
  description: business.description,
  address: business.address,
  latitude: business.latitude,
  longitude: business.longitude,
  // ADR 0024: the main Category stays under its old name for a client that reads only that.
  category: business.categories[0] ?? null,
  categories: business.categories,
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
/** A calendar as every owner screen is given it: the calendar, and what is still booked. */
export const resourceWithUpcomingOut = (entry: ResourceWithUpcoming) => ({
  ...resourceOut(entry.resource),
  upcomingAppointments: entry.upcoming,
});

export const staffedBusinessOut = (staffed: StaffedBusiness) => ({
  ...businessOut(staffed.business),
  role: staffed.role,
  resourceIds: staffed.resourceIds,
  entitlement: {
    features: staffed.entitlement.features,
    resourceAllowance: staffed.entitlement.resourceAllowance,
  },
  // The calendars travel with the business: the screen behind `/manage` needs
  // them to draw anything, and asking for them separately cost a round trip it
  // could not start until this one answered. Through the same shape the
  // resources endpoint sends, count included — a list without it reads as
  // "nobody booked" on the screen that asks before removing a calendar.
  resources: staffed.resources.map(resourceWithUpcomingOut),
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

/**
 * Who wrote it goes out as a given name only, and not at all for an anonymous
 * review; the author's id stays inside either way.
 */
export const reviewOut = (review: Review) => ({
  id: review.id,
  stars: review.stars,
  comment: review.comment,
  anonymous: review.anonymous,
  authorName: review.anonymous ? null : review.authorName,
  createdAt: formatInstant(review.createdAt),
  updatedAt: formatInstant(review.updatedAt),
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
  /** Taken out of booking for the Resource Allowance; still the owner's. */
  paused: resource.pausedAt !== null,
  /** The day it pauses, when a move to a smaller Plan is scheduled. */
  pausesOn: resource.pauseOn,
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

const rangesOut = (ranges: readonly LocalTimeRangeValue[]) =>
  ranges.map((range) => ({ start: formatLocalTime(range.start), end: formatLocalTime(range.end) }));

/** "שינוי ביומן", as every screen that shows one reads it. */
export const changeOut = (change: CalendarChange) => ({
  id: change.id,
  scope: change.scope,
  outcome: change.outcome,
  fromDate: change.fromDate,
  toDate: change.toDate,
  days: change.days.map((day) => ({ date: day.date, ranges: rangesOut(day.ranges) })),
  ranges: change.ranges === null ? null : rangesOut(change.ranges),
  note: change.note,
});

export const changePreviewOut = (preview: ChangePreview) => ({
  days: preview.days,
  calendars: preview.calendars,
  appointments: preview.appointments.map(strandedOut),
  replaces: preview.replaces.map(changeOut),
  usual: rangesOut(preview.usual),
  usualEverywhere: preview.usualEverywhere === null ? null : rangesOut(preview.usualEverywhere),
  sameAsUsual: preview.sameAsUsual,
  notWorkingAnyway: preview.notWorkingAnyway,
});

export const impactOut = (impact: Impact) => ({
  days: impact.days,
  calendars: impact.calendars,
  appointments: impact.appointments.map(strandedOut),
});

/**
 * ADR 0018. What a customer is waiting for, as their own screen reads it —
 * names rather than ids, because the list is shown beside their appointments
 * and those carry names too.
 */
export const waitingOut = (waiting: MyWaiting) => ({
  id: waiting.id,
  businessId: waiting.businessId,
  businessName: waiting.businessName,
  serviceId: waiting.serviceId,
  serviceName: waiting.serviceName,
  resourceNames: waiting.resourceNames,
  onDate: waiting.onDate,
  parts: waiting.parts,
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
    shopOpen: day.shopOpen,
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

/**
 * A customer's own list names the business — for an "add to calendar" title —
 * and places it, so the list can show the address and how far off it is.
 */
export const appointmentWithBusinessOut = ({
  appointment,
  businessName,
  businessCategory,
  resourceName,
  businessAddress,
  businessLatitude,
  businessLongitude,
}: {
  appointment: Appointment;
  businessName: string;
  businessCategory: BusinessCategory | null;
  resourceName: string;
  businessAddress: string | null;
  businessLatitude: number | null;
  businessLongitude: number | null;
}) => ({
  ...appointmentOut(appointment),
  businessName,
  businessCategory,
  resourceName,
  businessAddress,
  businessLatitude,
  businessLongitude,
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

/**
 * The signed-in User as they see themselves. The terms version is theirs
 * alone; a Business looking at a customer has no use for it.
 */
export const meOut = (user: User, isHasBusinesses: boolean, hadTrial: boolean) => ({
  ...userOut(user),
  termsVersion: user.termsVersion,
  isHasBusinesses,
  hadTrial,
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

/**
 * A Subscription with the Plan Version it is on, as one flat record: what the
 * owner is on, what it costs, what it gives, and what is changing.
 */
export const subscriptionOut = (view: SubscriptionView) => ({
  id: view.subscription.id,
  businessId: view.subscription.businessId,
  plan: view.planVersion.plan,
  planVersion: view.planVersion.number,
  priceMinor: view.planVersion.terms.price,
  price: toMajorUnits(view.planVersion.terms.price),
  resourceAllowance: view.planVersion.terms.resourceAllowance,
  features: view.planVersion.terms.features,
  trialEndsOn: view.subscription.trialEndsOn,
  paidThrough: view.subscription.paidThrough,
  scheduledMove:
    view.subscription.scheduledMove === null || view.scheduledVersion === null
      ? null
      : {
          plan: view.scheduledVersion.plan,
          planVersion: view.scheduledVersion.number,
          effectiveOn: view.subscription.scheduledMove.effectiveOn,
        },
});

/** One Plan as the pricing page and the plan chooser show it. */
export const planOut = (version: PlanVersion) => ({
  plan: version.plan,
  planVersion: version.number,
  priceMinor: version.terms.price,
  price: toMajorUnits(version.terms.price),
  resourceAllowance: version.terms.resourceAllowance,
  features: version.terms.features,
});

/** One line of the administrator's Businesses tab. */
export const directoryRowOut = (row: DirectoryRow) => ({
  business: businessOut(row.business),
  ownerName: row.owner?.name ?? null,
  ownerPhone: row.owner?.phone ?? null,
  plan: row.planVersion.plan,
  planVersion: row.planVersion.number,
  status: row.standing.status,
  nextDate: row.standing.nextDate,
  flags: row.standing.flags,
  /** How many Features it has by Grant, beyond its Plan. */
  granted: row.features.filter((source) => source.source === "GRANT").length,
});

/**
 * One Feature and where the Business has it from. The Grant's details go only
 * to an administrator: the owner's list is built from the Entitlement, which
 * carries no reason.
 */
export const featureOut = (source: FeatureSource<GrantTerm | GrantEntry>) => ({
  feature: source.feature,
  source: source.source,
  endsOn: source.endsOn,
  grant:
    source.grant !== null && "id" in source.grant
      ? {
          id: source.grant.id,
          reason: source.grant.reason,
          grantedBy: source.grant.grantedByName,
          grantedAt: formatInstant(source.grant.createdAt),
        }
      : null,
});

export const featuresOut = (sources: readonly FeatureSource<GrantTerm | GrantEntry>[]) => ({
  features: sources.map(featureOut),
});

const editionOut = (edition: PlanEdition) => ({
  id: edition.id,
  plan: edition.plan,
  number: edition.number,
  priceMinor: edition.terms.price,
  resourceAllowance: edition.terms.resourceAllowance,
  features: edition.terms.features,
  publishedAt: formatInstant(edition.publishedAt),
  firstMoveOn: edition.firstMoveOn,
});

const businessRefOut = (business: Business) => ({ id: business.id, name: business.name });

/** Each Plan as the Catalogue editor shows it: its editions, and any change waiting to land. */
export const planCatalogueOut = (result: { plans: readonly PlanView[]; previews: readonly Preview[] }) => ({
  plans: result.plans.map((view) => ({
    plan: view.plan,
    current: editionOut(view.current),
    editions: view.editions.map((entry) => ({
      ...editionOut(entry.edition),
      current: entry.current,
      businesses: entry.businesses,
    })),
    pending:
      view.pending === null
        ? null
        : {
            edition: editionOut(view.pending.edition),
            previous: editionOut(view.pending.previous),
            moving: view.pending.moving.map((move) => ({ business: businessRefOut(move.business), effectiveOn: move.effectiveOn })),
            joined: view.pending.joined.map(businessRefOut),
            cancellable: view.pending.cancellable,
          },
    ifTakenToday: view.ifTakenToday,
  })),
  previews: result.previews.map((preview) => ({ feature: preview.feature, endsOn: preview.endsOn })),
});

/** Each Feature as the Features tab shows it: where it is sold, a Preview of it, and who has it. */
export const featureViewsOut = (views: readonly FeatureView[]) => ({
  features: views.map((view) => ({
    feature: view.feature,
    plans: view.plans,
    preview:
      view.preview === null
        ? null
        : {
            endsOn: view.preview.endsOn,
            keepOn: view.preview.placement?.keepOn ?? null,
            decidedAt: view.preview.decidedAt === null ? null : formatInstant(view.preview.decidedAt),
          },
    addon:
      view.addon === null
        ? null
        : {
            priceMinor: view.addon.price,
            since: view.addon.since,
            rise:
              view.addon.rise === null
                ? null
                : {
                    fromMinor: view.addon.rise.from,
                    announcedOn: view.addon.rise.announcedOn,
                    firstOn: view.addon.rise.firstOn,
                    lastOn: view.addon.rise.lastOn,
                  },
          },
    counts: view.counts,
    canPreview: view.canPreview,
    canSell: view.canSell,
  })),
});

const daysChargeOut = (owed: DaysOwed) => ({ amountMinor: owed.amount, from: owed.from, through: owed.through });

/** What a Business pays: its Add-ons, its next payment line by line, and what moving up would owe. */
export const paymentBoardOut = (board: PaymentBoard) => ({
  addons: board.addons.map((addon) => ({
    feature: addon.feature,
    priceMinor: addon.price,
    onSale: addon.onSale,
    holding:
      addon.holding === null
        ? null
        : {
            addedOn: addon.holding.addedOn,
            paysFrom: addon.holding.paysFrom,
            priceMinor: addon.holding.price,
            nextPrice:
              addon.holding.nextPrice === null
                ? null
                : { priceMinor: addon.holding.nextPrice.price, effectiveOn: addon.holding.nextPrice.effectiveOn },
            endsOn: addon.holding.endsOn,
            ending: addon.holding.ending,
          },
    hadBefore: addon.hadBefore,
    inTrialUntil: addon.inTrialUntil,
    ifAdded:
      addon.ifAdded === null
        ? null
        : { paysFrom: addon.ifAdded.paysFrom, owed: addon.ifAdded.owed === null ? null : daysChargeOut(addon.ifAdded.owed) },
  })),
  nextPayment: {
    on: board.nextPayment.on,
    totalMinor: board.nextPayment.total,
    lines: board.nextPayment.lines.map((line) =>
      line.kind === "PLAN"
        ? { kind: line.kind, plan: line.plan, amountMinor: line.amount }
        : line.kind === "ADDON"
          ? { kind: line.kind, feature: line.feature, amountMinor: line.amount }
          : {
              kind: line.kind,
              owed: { kind: line.owed.kind, subject: line.owed.subject, ...daysChargeOut(line.owed) },
              amountMinor: line.owed.amount,
            },
    ),
  },
  moveUpOwed: board.moveUpOwed.map(({ plan, owed }) => ({ plan, ...daysChargeOut(owed) })),
});

/** A Unit Rate as the Catalogue tab shows it. */
export const unitRateOut = (rate: UnitRateEntry) => ({
  unit: rate.unit,
  effectiveFrom: rate.effectiveFrom,
  microShekels: rate.perUnit,
  source: rate.source,
  checkedBy: rate.checkedBy,
  enteredAt: formatInstant(rate.enteredAt),
});

/** The owner's or administrator's billing panel. */
export const billingOut = (
  result: SubscriptionView & {
    payments: readonly Payment[];
    features?: readonly FeatureSource<GrantTerm | GrantEntry>[];
    board?: PaymentBoard;
  },
) => ({
  subscription: subscriptionOut(result),
  payments: result.payments.map(paymentOut),
  state: result.state,
  status: result.standing.status,
  nextDate: result.standing.nextDate,
  flags: result.standing.flags,
  ...(result.features === undefined ? {} : { features: result.features.map(featureOut) }),
  ...(result.board === undefined ? {} : paymentBoardOut(result.board)),
});

/**
 * The owner's Notices and which one stands as the banner. A Notice goes out as
 * its facts: the words are the web's, in the owner's own language.
 */
export const noticeBoardOut = (board: NoticeBoard) => ({
  notices: board.notices.map((notice) => ({
    id: notice.id,
    kind: notice.facts.kind,
    tone: noticeTone(notice.facts.kind),
    facts: notice.facts,
    createdAt: formatInstant(notice.createdAt),
    read: notice.readAt !== null,
    standing: isStanding(notice),
  })),
  banner: board.banner,
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
