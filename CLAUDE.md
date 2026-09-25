# tor-now

Multi-tenant appointment booking. npm workspaces, no monorepo tooling.

- `packages/domain` — scheduling rules as pure functions. No I/O, no clock, no DB.
  Runs under Node, Deno and the browser; keep it runtime-agnostic.
- `services/api` — Hono Edge Function. Ports/adapters, composition root in `src/composition.ts`.
- `apps/web` — Next.js, Hebrew + English.
- `supabase/migrations` — schema, append-only. Never edit a shipped migration.

## Rules

- Every write goes through a decorated repository. No ad-hoc SQL, no
  cron job touching tables directly.
- A new repository method needs a case in the contract suite that actually runs it —
  the build fails on any method Postgres never saw. Hand-written SQL is untyped.
- `supabase/functions/api/index.js` is a build artifact, committed and pinned by
  deploy. Run `npm run build:api` after touching `services/api/src` or CI fails.
- Read the relevant `docs/adr/` file before changing behaviour it decided.
  `CONTEXT.md` is the glossary — use its words, avoid the listed synonyms.
- Run `npm run lint` before claiming a feature done — the pre-push policy
  enforces it, so a lint error caught late just means redoing the push.
- When you change dictionary value, make sure to update all languages too.

Change legal docs/terms and TERMS_VERSION when:
  - We collect something new. For example, email, precise location, or photos of customers.
  - Data is used for a new purpose or shared with someone new. For example, a new analytics tool, a new SMS/WhatsApp provider, a server in a new country, or businesses seeing more about         
    customers than today.
  - Retention or deletion rules change. For example, how long data is kept, or how account deletion works.
  - User rights or obligations change. For example, cancellation rules, fees, business subscription or grace-period terms, new prohibited uses, or who owns content.
  - Liability, indemnity or jurisdiction change.
  - The company changes. For example, a new legal entity or ח״פ, or the service transferring to another company.

  Don't change the TERMS_VERSION for:
  - styling, layout or fonts on the legal pages;
  - typos, grammar, or rewording that keeps the meaning;
  - updated contact details, such as a new support email (edit the text, no notice needed);
  - the accessibility statement, which isn't a contract;
  - filling the placeholders before launch.

## Commands

```bash
npm run check      # typecheck + unit tests — run before claiming done
npm run lint       # eslint — run before claiming done
npm run test:db    # + repository contract against a throwaway Postgres
npm run test:e2e   # 40 journeys, phone + desktop
npm run build:api  # regenerate the committed Edge Function bundle
```

Setup, deployment, env vars and test layout are in `README.md`.
