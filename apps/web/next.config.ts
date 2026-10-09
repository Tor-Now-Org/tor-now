import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

/**
 * The domain package is consumed as TypeScript source rather than as a built
 * artifact, so the same rules run in the browser, under Node for the tests and
 * under Deno in the Edge Function — one implementation, three runtimes.
 */
const config: NextConfig = {
  transpilePackages: ["@tor-now/domain"],
  reactStrictMode: true,
};

// ADR 0027: serves BotID's challenge from our own domain.
export default withBotId(config);
