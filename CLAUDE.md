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

## Commands

```bash
npm run check      # typecheck + unit tests — run before claiming done
npm run test:db    # + repository contract against a throwaway Postgres
npm run test:e2e   # 40 journeys, phone + desktop
npm run build:api  # regenerate the committed Edge Function bundle
```

Setup, deployment, env vars and test layout are in `README.md`.
