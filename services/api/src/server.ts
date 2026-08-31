import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compose } from "./composition.ts";
import { createApp } from "./http/app.ts";

/**
 * The same application, served by Node instead of Deno.
 *
 * Nothing below `index.ts` is Deno-specific, which is what makes this possible
 * — and what makes the end-to-end tests worth running: they exercise the real
 * routing, the real domain and a real Postgres, rather than a mock standing in
 * for the API.
 *
 * This is for development and for the end-to-end suite. Production is the Edge
 * Function.
 */
const PORT = Number(process.env["PORT"] ?? 8787);

const { services } = compose(process.env);

const root = new Hono();
root.route("/api", createApp(services));

serve({ fetch: root.fetch, port: PORT }, (address) => {
  // eslint-disable-next-line no-console -- the only line this process prints
  console.log(`api listening on http://localhost:${address.port}/api`);
});
