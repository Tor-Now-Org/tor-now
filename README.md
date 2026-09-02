# Tor Panuy · תור פנוי

A multi-tenant appointment booking platform. Service businesses publish their
availability; customers find a business and book a time slot against it.

The design was written down before the code. [`CONTEXT.md`](./CONTEXT.md) is the
domain glossary, [`CONTEXT-MAP.md`](./CONTEXT-MAP.md) names the two bounded
contexts and the single seam between them, and [`docs/adr/`](./docs/adr) records
the fifteen decisions everything here rests on. If something in the code looks
arbitrary, the ADR that made it is the place to look.

- **Interface** — https://tor-now-tor-now.vercel.app (the Vercel project is
  still named `tor-now`; renaming it moves this URL)
- **API** — https://kbybnveitlxkffqptvqm.supabase.co/functions/v1/api

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

**The API** is bundled, committed, and deployed by
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) on every push
to `main`:

```bash
npm run build:api    # services/api/src → supabase/functions/api/index.js
git commit && git push
```

The workflow rebuilds the bundle and refuses to deploy if the committed artifact
differs from the build of `services/api/src`, so what runs is exactly what is in
git at that revision. It needs two repository secrets — `SUPABASE_ACCESS_TOKEN`
and `SUPABASE_DB_PASSWORD` — and without them it reports what it would have done
and succeeds, so a fork is not blocked by a secret it cannot have.

### Where it runs

The database is in `eu-central-1` (Frankfurt), which is where it belongs: the
Edge Function runs near the customer, and every read is a round trip between the
two. It began life in `ap-northeast-1` (Tokyo), where that round trip measured
228ms — search took four seconds and opening a business took eleven, almost all
of it spent crossing the planet rather than doing work. Distance to the database
is the platform's dominant latency term, so a future region change is a
performance decision, not an administrative one.

### Setting up a new deployment

Two things are per-deployment configuration rather than schema, and neither
belongs in a migration:

```sql
-- where scheduled work posts (pg_cron → pg_net → the API)
update app.job_credential
set api_base_url = 'https://<project-ref>.supabase.co/functions/v1/api'
where id;
```

and `NEXT_PUBLIC_API_URL` on the Vercel project, which points the interface at
that same API. Both have no sensible default: `app.job_target` raises rather
than guess, so a misconfigured deployment fails loudly instead of quietly
posting nowhere.

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
npm run typecheck    # four projects: domain, API, end-to-end, interface
npm run lint         # what the compiler cannot see
npm test             # 287 unit and integration tests
npm run test:db      # the same, plus the repository contract against a real Postgres
npm run test:e2e     # 40 journeys, each at a phone and a desktop viewport
```

`test:db` and `test:e2e` each start a throwaway Postgres, apply every migration
exactly as written, and take it down again — so a migration that only works on
Supabase fails locally rather than at deploy time. Both need `initdb` and
`pg_ctl` on the path.

### How the tests are arranged

**The domain** is tested as pure functions: timezone conversion across a
daylight-saving transition, the greedy walk, the three schedule layers, the
booking window, cancellation and billing.

**The repository seam** has one contract suite run against two implementations —
in memory always, and against Postgres whenever one is reachable. A seam is only
real if both sides behave alike, and the two Row Level Security faults in this
system reached production for want of exactly that.

That suite carries a rule of its own: **a repository method that never reaches
Postgres fails the build.** A repository method is hand-written SQL, and
hand-written SQL is the one place here where renaming a column does not become a
type error — a row is a bag of unknowns until the mapper reads it. Two
statements have gone wrong exactly that way, and the second went on selecting a
column the name split had renamed four migrations earlier, because nothing ever
executed it. The check is not a scan for column names, which would only find the
mistakes somebody thought of; it records which methods the contract actually
called and names any that it did not. Adding a query therefore means adding the
case that runs it.

**The application and HTTP layers** run against the in-memory adapters, wired by
the same composition the Edge Function uses, so the wiring is under test too.
Hono's `app.request` exercises routing, validation and error translation without
a socket.

**End to end** runs the built interface against the real API served by Node,
against a real database. Tests are written in terms of what a person sees, so a
test that breaks is a change a user would also have noticed.

```bash
psql "$DATABASE_URL" -f supabase/tests/invariants.sql   # succeeds on ALL_INVARIANTS_HELD
node scripts/seed.mjs                                   # demo data, through the API
```

`invariants.sql` proves what lives in the database rather than in application
code — the exclusion constraint, buffer enforcement, cancelled slots becoming
rebookable, the append-only audit trail, the composite foreign key that stops a
Resource being borrowed by another Business, and that an erasure clears a name
without orphaning the appointments that refer to it. It rolls itself back.

## Continuous integration

Seven checks are required before a pull request can merge: types, lint, ruff,
unit and integration tests, end-to-end, security and CodeQL.

The security job fails on a high-severity dependency advisory, scans the whole
history for secrets, and rebuilds `supabase/functions/api/index.js` to fail if
the committed artifact has drifted from its sources — deployment pins that file
by commit, so a stale one would ship code that is not in the pull request.

There is no Python here, so the ruff job detects that and says so. It will lint
the first `.py` file the day one appears.

## Scheduled work

Four cron jobs, defined in the `scheduled_work` migration and driven by
`pg_cron`: draining the notification outbox every minute, sending reminders
hourly, pruning the audit log nightly, and deactivating businesses whose
subscription lapsed past its grace period. They call the Edge Function rather than writing SQL directly, because
ADR 0006 makes "every write goes through a decorated repository" a standing
constraint — a cron job reaching into the tables is exactly the ad-hoc script
that ADR warns produces no audit trail.

They authenticate with a credential generated inside the database and read by
both sides from there, so there is no secret for an operator to copy or leak.
