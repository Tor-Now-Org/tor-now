# Scheduling

A multi-tenant appointment booking platform. Service businesses publish their
availability; customers find a business and book a time slot against it.

## Language

**Business**:
A tenant of the platform — the service provider a customer books with. Owns
services, resources, and the customers who book with it. Active on registration
and discoverable in search until an administrator deactivates it.
_Avoid_: Organization, tenant, shop, vendor

**Resource**:
A single bookable calendar belonging to a Business. Every Business has at least
one. Working hours, breaks, blocks, overrides and appointments all belong to a
Resource, never directly to a Business.
_Avoid_: Staff, employee, chair, room, provider

**User**:
A person with an identity on the platform, identified by a verified phone number.
Holds no relationship to any Business; a User is neither a customer nor an owner
on their own.
_Avoid_: Account, profile, client, member

**Verification**:
Proving control of a phone number by entering a code delivered over WhatsApp. The
platform's only authentication mechanism: registering, logging in and confirming a
booking are all the same act.
_Avoid_: Login, sign-in, OTP, 2FA, authentication

**Membership**:
The relationship between one User and one Business, carrying the role the User
holds there. The same User may own one Business and be a customer of another.
Authorization is the existence of a Membership, not a property of the User.
_Avoid_: Role, association, link, customer record

**Customer**:
A User seen through a Membership with the customer role — someone who books with
a given Business. "Customer" is always relative to a Business; there is no
customer in the abstract.
_Avoid_: Client, patron, end user

**Administrator**:
An operator of the platform itself, not a User of any Business. Holds no
Membership and books nothing; deactivates a Business, records a Payment against a
Subscription, and reads a customer record for support. Every action is audited,
reads included.
_Avoid_: Superuser, staff, moderator, root

**Service**:
Something a Business offers at a defined duration and price. The chosen Service
determines how much time an appointment consumes.
_Avoid_: Treatment, product, offering

**Appointment**:
A booked reservation of a Resource's time by a customer, for one Service. Exists
only in a confirmed state; there is no provisional or held Appointment.
_Avoid_: Booking, reservation, meeting, session, tor

**Reschedule**:
Moving an existing Appointment to a different time, keeping its identity. A
Business action only, and never a cancellation — a customer wanting a different
time cancels and books again.
_Avoid_: Move, change, reissue, rebook

**Cancellation Window**:
The notice period a Business asks its customers to give when cancelling, measured
back from the Appointment's start. It governs visibility, not permission — a
customer may always cancel, and cancelling inside the window is recorded as a Late
Cancellation.
_Avoid_: Cancellation policy, notice period, deadline

**Late Cancellation**:
A customer cancellation made inside the Cancellation Window. Recorded against the
customer and visible to the Business, but never blocked.
_Avoid_: Short notice, violation, breach

**No Show**:
An Appointment whose time passed without the customer attending, marked as such
by the Business. Distinct from a cancellation, which is a decision taken before
the fact by a named party.
_Avoid_: Missed, absent, skipped

**Working Hours**:
A recurring wall-clock rule stating when a Resource is open — a day of the week
and one local time range. A weekday may carry several, and the gaps between them
are the Resource's breaks; there is no separate notion of a break.
_Avoid_: Schedule, opening hours, shift, break, availability

**Date Override**:
A per-date replacement for a Resource's Working Hours. Overrides for a date
supersede that weekday's recurring rules entirely; a date marked closed with no
ranges is a day off.
_Avoid_: Exception, special hours, holiday, vacation

**Block**:
An ad-hoc interval carved out of a Resource's otherwise open time, with a reason.
Used for one-off unavailability that does not change the schedule itself.
_Avoid_: Break, hold, busy, unavailability

**Local Time**:
A wall-clock time in the Business's own timezone, with no date attached. The unit
of every recurring rule: Working Hours, Breaks, and the times inside an Override.
_Avoid_: Business time, naive time, plain time

**Instant**:
An absolute moment on the timeline, stored in UTC. The unit of anything that
actually happened or will happen — an Appointment's start and end. Never used for
recurring rules.
_Avoid_: Timestamp, datetime, absolute time

**Buffer**:
Recovery time reserved after an Appointment before the Resource is free again.
Defined on the Service, falling back to the Business default. An Appointment
therefore occupies its duration plus its Buffer.
_Avoid_: Gap, padding, rest, cooldown

**Minimum Notice**:
The shortest warning a Business will accept before an Appointment starts, measured
from now. Trims the near end of availability, so a customer needing time sooner is
shown the Business's phone number rather than a Slot.
_Avoid_: Lead time, cutoff, advance notice

**Booking Horizon**:
How far ahead of now a Business accepts bookings. Trims the far end of
availability, bounding both the calendar a customer sees and the future any
schedule change has to be checked against.
_Avoid_: Booking window, lookahead, max advance

**Free Interval**:
A stretch of Local Time in which a Resource is open and unencumbered — Working
Hours minus Breaks, Blocks, Overrides and occupied Appointments. The input to
slot generation, and the point where all scheduling constraints have been
resolved into one shape.
_Avoid_: Window, opening, gap, availability

**Slot**:
A candidate start time offered to a customer. Slots are computed on demand, never
stored — a Slot only exists in the answer to "when is this Resource free?".
_Avoid_: Timeslot, opening, availability
