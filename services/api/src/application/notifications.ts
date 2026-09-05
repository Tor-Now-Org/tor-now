import { displayName, formatInstant, type Appointment } from "@tor-now/domain";
import type { OutboundMessage } from "../ports/notifier.ts";

/**
 * The message an event produces, addressed and filled in.
 *
 * Shared because more than one service now causes one: a booking is made,
 * moved or called off by the customer, and a calendar being taken away calls
 * off everything on it. The same event should not read differently to the
 * person receiving it depending on which service raised it.
 */
export const notificationFor = (
  template: OutboundMessage["template"],
  appointment: Appointment,
  business: { name: string; phone: string; timeZone: string },
  customer: { givenName: string; familyName: string | null; phone: string },
  previousStartAt?: string,
): OutboundMessage => ({
  recipientPhone: customer.phone,
  template,
  payload: {
    businessName: business.name,
    businessPhone: business.phone,
    serviceName: appointment.serviceName,
    customerName: displayName(customer),
    startAt: formatInstant(appointment.startAt),
    ...(previousStartAt === undefined ? {} : { previousStartAt }),
  },
});
