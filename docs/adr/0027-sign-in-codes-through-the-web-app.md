# 27. Sign-in codes are requested through the web app

Date: 2026-10-09

## Status

Accepted. Builds on ADR 0004 (rate limiting narrows to code issuance and
checking) and ADR 0015 (the service issues its own codes).

## Context

`POST /auth/request-code` was called by the browser straight on the Supabase
Edge Function, whose address ships in the page. Its only throttle counts codes
per phone, so a script sending one code each to many numbers was not slowed at
all. Every code is a WhatsApp message the platform pays for, and many messages
nobody asked for lower the sender's quality rating with Meta, which can cap the
messages real customers depend on to sign in.

Vercel already serves the web app, and offers BotID (an invisible bot check)
and a firewall that can rate-limit by IP. Neither sees a request that never
passes through Vercel.

## Decision

- The browser requests a code from the web app's own route,
  `POST /api/auth/request-code`. The route runs BotID's `checkBotId()` and
  refuses a bot before anything is sent.
- The route forwards the request to the API with `X-Sign-In-Proxy`, a secret
  shared through `SIGN_IN_PROXY_SECRET` on both Vercel and the Edge Function.
- The API refuses a code request without that secret whenever one is set, and
  always on a real verification transport. A real transport with no secret
  sends no codes: the check fails at the route, not at boot, so a missing
  secret stops sign-in codes but not bookings for people already signed in.
- A deployment on the log transport with no secret stays open. It sends
  nothing, and the unit tests and local development rely on it.
- Off Vercel, BotID has nothing to ask and answers "human"; the route says so
  explicitly rather than leaving it to `NODE_ENV`.

## Consequences

- A script calling the API directly gets nothing sent. One calling the web
  app's route faces BotID and the Vercel Firewall rules on that path.
- Code requests take one more hop, from Vercel to Supabase.
- Deploying needs the secret in both places first. Deploying the API with a
  real transport and no secret stops new sign-ins until it is set.
- The secret is a credential like the Twilio ones. Rotating it means setting
  the new value on both sides together.
- Verifying a code (`/auth/verify`) still goes straight to the API. It sends
  nothing and is already limited per code.
