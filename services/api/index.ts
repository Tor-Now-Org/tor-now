import { Hono } from "hono";
import { compose } from "./src/composition.ts";
import { createApp } from "./src/http/app.ts";

/**
 * The only file that touches Deno. Everything beneath it is runtime-agnostic
 * TypeScript, which is what lets the domain and application layers run under
 * Node for the tests and under Deno in production (ADR 0007).
 *
 * Supabase routes a function's requests with its own name still on the path,
 * so the whole API is mounted under `/api`.
 */
declare const Deno: { env: { toObject(): Record<string, string> }; serve: (handler: (request: Request) => Response | Promise<Response>) => unknown };

const { services } = compose(Deno.env.toObject());

const root = new Hono();
root.route("/api", createApp(services));

Deno.serve(root.fetch);
