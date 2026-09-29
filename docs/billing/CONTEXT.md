# Billing

What each Business owes the platform for using it, and whether they have paid.
Concerns the platform operator and the Business owner — never the customer, who
pays the Business directly and outside the system entirely.

## Language

**Subscription**:
A Business's standing agreement to pay the platform: a Plan, an amount, a billing
period, and the date it is paid through. Every Business has one, from the moment
it opens.
_Avoid_: Membership, account, licence

**Plan**:
A named offering a Subscription is on — Solo or Team. Every Plan is paid; there is
no free Plan.
_Avoid_: Tier, package, level, bundle

**Trial**:
The first thirty days of a Subscription, owed nothing, on whichever Plan the owner
chose. Given once per owner, not per Business: a second Business opened by the
same owner starts with payment due, and changing Plan does not start another. An
unpaid Trial has no Grace Period: it ends in Deactivation.
_Avoid_: Free plan, free tier, demo

**Feature**:
A named capability a Subscription either grants or does not. Billing knows a
Feature only by its name, never by what it does.
_Avoid_: Module, capability, perk

**Resource Allowance**:
The number of Resources a Plan lets a Business keep. The only thing a Plan
limits; people on the team are never counted.
_Avoid_: Seat, calendar limit, quota

**Plan Version**:
One fixed edition of a Plan's contents: its Features, Resource Allowance and
price. A Subscription stays on the Plan Version it joined until it is moved,
and is moved only after a Notice, at its next renewal.
_Avoid_: Revision, edition, legacy plan

**Notice**:
A message from the platform to a Business about what its Subscription grants or
costs — a Feature gained, a Preview ending, a move to another Plan Version, a
payment due. Whatever takes value away is announced thirty days ahead; whatever
adds value is announced when it happens. Every Notice is kept in the owner's
list; the ones that need a look stand as a banner until acknowledged, and only
the ones about paying also go out on WhatsApp.
_Avoid_: Announcement, notification, warning, alert

**Catalogue**:
The single statement of what every Plan and Add-on currently offers and costs.
The pricing page, upgrade prompts and Entitlements all derive from it.
_Avoid_: Price list, pricing table, matrix

**Add-on**:
A Feature sold on its own, at one flat monthly price, on top of any Plan. Reserved
for what only one Category wants or what would raise every Plan's price if
bundled; never more than two on sale at once. The owner adds and cancels their
own: the first time, it is theirs at once and paid from the next payment; added
back after it ended, the Days Owed come with it. A Trial includes every Add-on
on sale, and a Plan that comes to include one ends it.
_Avoid_: Extra, upsell, module

**Days Owed**:
The part of a month owed before the next payment, when a Business adds back an
Add-on it had or moves up again to a Plan it left. Counted by thirtieths of the
monthly price, and settled by the Payment it is part of. Only the first time is
free until the next payment, so nothing added, cancelled and added again is ever
free twice.
_Avoid_: Charge, proration, fee

**Preview**:
A newly launched Feature offered on every Plan for a stated period, labelled as
not yet placed. When it ends, the Feature joins a Plan or becomes an Add-on.
_Avoid_: Beta, early access, trial

**Fair Use Limit**:
An internal ceiling on how much a cause of messages — booking, reminders, the
waiting list — may cost the platform for one Business in a calendar month, set
well above what a busy Business uses; and one for the sign-in codes the whole
platform sends in a day. Never priced, never shown as an allowance; crossing it
means abuse is suspected, not that more is owed. It only alerts, and whether a
Business is over one is read from its usage whenever an administrator looks —
never stored, so a new month starts clean on its own.
_Avoid_: Quota, allowance, cap, meter, over-usage status

**Platform Cost**:
What the platform pays that no Business caused: sign-in codes, measured from
Usage Records, and running costs — hosting, the website, a phone number — each
a monthly amount entered by hand from a day, with where the figure came from,
like a Unit Rate. A month's Platform Cost over the Businesses paying for it is
the share every price has to cover.
_Avoid_: Overhead, expenses, fixed cost

**Reference Business**:
A Business saved in the Cost Calculator as an example to price from: a month of
its messages per cause, in the units a provider bills, and its calendars.
Shared by every administrator, eight at most. The measured examples — the actual
average and the most expensive paying Business — are read from usage and are
never saved.
_Avoid_: Preset, template, profile

**Grant**:
One Feature given to one Business beyond what its Plan Version includes, for a
stated reason and until a stated date. Never permanent.
_Avoid_: Override, exception, comp, gift

**Usage Record**:
One billable thing that happened — a message sent, in so many units —
attributed to the Business and the Feature that caused it. Holds no price;
its cost is worked out from the Unit Rate in force on the day it happened.
_Avoid_: Cost record, usage event, charge, expense line

**Entitlement**:
What a Subscription grants at a given moment: its Features and its Resource
Allowance. The one thing Billing tells Scheduling beyond Deactivation.
_Avoid_: Permissions, access, rights, limits

**Payment**:
A recorded receipt of money from a Business to the platform, entered by an
administrator. The platform moves no money itself; a Payment is a record of
something that already happened elsewhere.
_Avoid_: Transaction, charge, invoice, settlement

**Grace Period**:
The interval after a Subscription falls due during which the Business continues
to operate unaffected, on the same Plan. Only a Subscription that has received at
least one Payment has one. Fourteen days; Deactivation follows only once it
elapses. A Trial never has one.
_Avoid_: Overdue window, buffer, leniency

**Unit Rate**:
What one unit — a WhatsApp template of a given category, or one SMS segment —
cost from a given day, and where that figure was checked. A correction is a new
Unit Rate from the day it applies, which may be in the past; Usage Records are
never rewritten.
_Avoid_: Price, tariff, fee

**Standing**:
Where a Business stands with the platform at a given moment: exactly one of
Trial, Paid, In grace, Lapsed or Deactivated. Lapsed is unpaid past the Trial or
the Grace Period; Deactivated is switched off by an administrator for any other
reason.
_Avoid_: Account status, billing state, health

**Flag**:
A fact beside a Standing that asks an administrator for a look — a Trial ending
within seven days, a move pending, more Resources on offer than the Allowance.
Never a Standing of its own.
_Avoid_: Alert, warning, badge

**Deactivation**:
Removing a Business from search and refusing new bookings against it, because its
Subscription lapsed beyond the Grace Period. Never affects Appointments that
already exist.
_Avoid_: Suspension, disabling, cancellation, termination
