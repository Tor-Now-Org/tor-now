import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The interface's own "@/" imports, so a module that reaches for the shared
  // library is testable without a bundler.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      // The interface's own pure modules — copy, formatting — which need no
      // browser to be worth checking.
      "apps/web/src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "services/*/src/**"],
      exclude: ["**/*.test.ts", "**/testing/**", "**/index.ts"],
    },
  },
});
