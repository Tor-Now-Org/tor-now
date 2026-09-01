import type { NextConfig } from "next";

/**
 * The domain package is consumed as TypeScript source rather than as a built
 * artifact, so the same rules run in the browser, under Node for the tests and
 * under Deno in the Edge Function — one implementation, three runtimes.
 */
const config: NextConfig = {
  transpilePackages: ["@tor-now/domain"],
  reactStrictMode: true,
};

export default config;
