# 4. Phone number plus WhatsApp code as the only authentication

Date: 2026-08-24

## Status

Accepted

Supersedes the specification's authentication sections, which described Google
sign-in and username/password as the two supported methods.

## Context

The product requires WhatsApp as its only notification channel, which means every
User must have a verified phone number regardless of how they authenticate.

Retaining Google sign-in and passwords alongside phone verification would mean
maintaining three authentication paths, plus account-linking rules for a person
arriving through different doors, plus a verification step layered on top of
whichever door they used — while the phone number remains the thing that actually
has to be proven.

## Decision

Authentication is phone number plus a verification code delivered over WhatsApp,
and nothing else. Registration and login are the same flow: an unrecognised number
becomes a new User, a recognised one is logged in.

Removed from the model: `username`, `passwordHash`, `googleId`, password reset
tokens, forgot-password and change-password flows. `phone` becomes the User's
unique identity key.

Booking requires an authenticated User. A customer with a live session books
without any further step; one without a session verifies inline during the
booking flow.

## Consequences

- Registration, login, phone verification and booking confirmation collapse into
  one mechanism instead of four.
- An entire class of vulnerability disappears: no stored credentials, no
  credential stuffing, no reset-token handling. Rate limiting narrows to code
  issuance and code checking.
- The booking flow no longer redirects off-site, shortening the unheld window
  between choosing a slot and confirming it.
- WhatsApp becomes a single point of failure for the product. A Meta outage
  prevents all new logins and therefore all new bookings; only holders of live
  sessions are unaffected.
- Every login costs a message, which makes session lifetime a cost decision as
  much as a security one. ADR 0009 settles it at thirty days for every role.
- Account recovery has no self-service path. A User who loses access to their
  number cannot prove ownership of their history, and requires operator
  intervention.
- Business owners authenticate the same way. An owner account grants access to
  all of that Business's customer data, so the security of that data now rests on
  the owner's control of their phone number and WhatsApp account.
