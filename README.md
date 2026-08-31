# Tor Now

A multi-tenant appointment booking platform. Service businesses publish their
availability; customers find a business and book a time slot against it.

The design was written down before the code. [`CONTEXT.md`](./CONTEXT.md) is the
domain glossary, [`CONTEXT-MAP.md`](./CONTEXT-MAP.md) names the two bounded
contexts and the single seam between them, and [`docs/adr/`](./docs/adr) records
the twelve decisions everything here rests on. If something in the code looks
arbitrary, the ADR that made it is the place to look.

- **Interface** — https://tor-now-tor-now.vercel.app
- **API** — https://boiqhhckvypicjfpeuem.supabase.co/functions/v1/api

## Layout

```
packages/domain/      the rules, as pure functions — no I/O, no clock, no database
services/api/         the Edge Function: ports, adapters, composition root, routing
  scripts/bundle.mjs  builds the single deployable artifact
apps/web/             five interfaces in Hebrew and English (Next.js on Vercel)
supabase/
  migrations/         the schema, in the order it was built
  tests/invariants.sql  invariants proved against a real Postgres
  functions/api/      the built artifact, committed so a deploy can pin it
scripts/seed.mjs      demo data, created through the API rather than inserted
```

The domain is runtime-agnostic TypeScript. The same file runs under Node for the
tests, under Deno in the Edge Function, and in the browser through
`transpilePackages` — one implementation of the scheduling rules, not three.

## Running it

```bash
npm install
npm run dev          # the interface at http://localhost:3000
npm run check        # typecheck all three projects, then the unit tests
```

`NEXT_PUBLIC_API_URL` points the web app at an API; with nothing set it uses the
deployed one above.

## Deploying

**The interface** deploys itself: Vercel builds `main` on every push, and
[`vercel.json`](./vercel.json) describes the build so the settings live in the
repository rather than in a dashboard.

**The API** is bundled and then pinned:

```bash
npm run build:api    # services/api/src → supabase/functions/api/index.js
git commit && git push
```

then deploy an entry point that imports the artifact at that commit SHA.
Supabase resolves and inlines the import when it builds the function, so the
running function has no dependency on GitHub — and what runs is exactly what is
in git at that revision.

### Configuration

The function reads everything from its environment. Supabase injects
`SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the rest are optional.

| Variable | Effect |
| --- | --- |
| `SUPABASE_DB_URL` | the direct Supavisor connection string, not PostgREST |
| `SUPABASE_JWT_SECRET` | signs sessions; falls back to deriving a key from the service role key |
| `VERIFICATION_TRANSPORT` | `LOG` (default), `WHATSAPP` or `SMS` |
| `NOTIFICATION_TRANSPORT` | `LOG` (default), `WHATSAPP` or `SMS` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SMS_FROM` | required by the non-`LOG` transports |
| `EXPOSE_VERIFICATION_CODE` | forces the development behaviour below on or off |
| `CORS_ORIGINS` | comma-separated allowlist; empty reflects the caller |

**A deployment with no delivery channel returns the verification code in its own
response.** That is not a convenience: with `VERIFICATION_TRANSPORT=LOG` nothing
delivers a code, so a code that is not returned is a code nobody can enter, and
the deployment could authenticate no one. Configuring a real transport turns it
off, and the configuration refuses to boot with both. `/health` reports which
mode is live. **This is the first thing to change before real customers.**

## Checks

```bash
npm run check                                   # 114 unit tests, three typecheck projects
psql "$SUPABASE_DB_URL" -f supabase/tests/invariants.sql   # succeeds on ALL_INVARIANTS_HELD
node scripts/seed.mjs                           # demo data, through the API
```

`invariants.sql` proves the things that live in the database rather than in
application code — the exclusion constraint, buffer enforcement, cancelled slots
becoming rebookable, the append-only audit trail, and the composite foreign key
that stops a Resource being borrowed by another Business. It rolls itself back.

## Scheduled work

Three cron jobs, defined in the `scheduled_work` migration and driven by
`pg_cron`: draining the notification outbox every minute, pruning the audit log
nightly, and deactivating businesses whose subscription lapsed past its grace
period. They call the Edge Function rather than writing SQL directly, because
ADR 0006 makes "every write goes through a decorated repository" a standing
constraint — a cron job reaching into the tables is exactly the ad-hoc script
that ADR warns produces no audit trail.

They authenticate with a credential generated inside the database and read by
both sides from there, so there is no secret for an operator to copy or leak.
