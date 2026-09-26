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
costs — a Feature gained, a Preview ending, a move to another Plan Version.
Whatever takes value away is announced thirty days ahead; whatever adds value is
announced when it happens.
_Avoid_: Announcement, notification, warning, alert

**Catalogue**:
The single statement of what every Plan and Add-on currently offers and costs.
The pricing page, upgrade prompts and Entitlements all derive from it.
_Avoid_: Price list, pricing table, matrix

**Add-on**:
A Feature sold on its own, at one flat monthly price, on top of any Plan. Reserved
for what only one Category wants or what would raise every Plan's price if
bundled; never more than two on sale at once.
_Avoid_: Extra, upsell, module

**Preview**:
A newly launched Feature offered on every Plan for a stated period, labelled as
not yet placed. When it ends, the Feature joins a Plan or becomes an Add-on.
_Avoid_: Beta, early access, trial

**Fair Use Limit**:
An internal ceiling on how much a Feature may cost the platform for one Business,
set well above what a busy Business uses. Never priced, never shown as an
allowance; crossing it means abuse is suspected, not that more is owed.
_Avoid_: Quota, allowance, cap, meter

**Grant**:
One Feature given to one Business beyond what its Plan Version includes, for a
stated reason and until a stated date. Never permanent.
_Avoid_: Override, exception, comp, gift

**Cost Record**:
One thing the platform paid for on a Business's behalf — a message sent, say —
attributed to the Feature that caused it, with its amount.
_Avoid_: Usage event, charge, expense line

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
